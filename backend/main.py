from __future__ import annotations

import json
import re
from datetime import datetime
from typing import List, Optional

import feedparser
import httpx
from fastapi import BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy import func, text
from sqlalchemy.orm import Session

try:
	from .auth_routes import router as auth_router
	from .app_factory import create_app
	from .config import ensure_secure_runtime_settings, settings
	from .cache_assets import (
		cache_identicon,
		cache_site_favicon,
		ensure_cache_dirs,
	)
	from .db import SessionLocal, get_db, init_db
	from .dependencies import get_current_user
	from .fetcher import format_fetch_error, process_feed
	from .models import (
		Entry,
		Feed,
		FetchLog,
		FilterRule,
		Folder,
		User,
		UserEntryState,
	)
	from .network_safety import fetch_text_response_async
	from .plugin_loader import list_available_plugins, load_plugins
	from .schemas import (
		AppSettingsIn,
		AppSettingsOut,
		BatchStateUpdate,
		DebugEntryOut,
		EntryPageOut,
		EntryOut,
		EntryStateUpdate,
		FeedIn,
		FeedOut,
		FeedUnreadCountOut,
		FeedValidateIn,
		FeedValidateOut,
		FetchLogOut,
		FilterIn,
		FilterOut,
		FolderIn,
		FolderOut,
		PluginSettingsIn,
		PluginSettingsOut,
		SearchResult,
		UserOut,
	)
	from .scheduler import start_scheduler
	from .security import hash_password
	from .services import ConfigStore
	from .static_mounts import mount_cache_static, mount_frontend_static
except ImportError:  # pragma: no cover - fallback for direct script execution
	import os
	import sys

	sys.path.append(os.path.dirname(os.path.dirname(__file__)))
	from backend.auth_routes import router as auth_router
	from backend.app_factory import create_app
	from backend.config import ensure_secure_runtime_settings, settings
	from backend.cache_assets import (
		cache_identicon,
		cache_site_favicon,
		ensure_cache_dirs,
	)
	from backend.db import SessionLocal, get_db, init_db
	from backend.dependencies import get_current_user
	from backend.fetcher import format_fetch_error, process_feed
	from backend.models import (
		Entry,
		Feed,
		FetchLog,
		FilterRule,
		Folder,
		User,
		UserEntryState,
	)
	from backend.network_safety import fetch_text_response_async
	from backend.plugin_loader import list_available_plugins, load_plugins
	from backend.schemas import (
		AppSettingsIn,
		AppSettingsOut,
		BatchStateUpdate,
		DebugEntryOut,
		EntryPageOut,
		EntryOut,
		EntryStateUpdate,
		FeedIn,
		FeedOut,
		FeedUnreadCountOut,
		FeedValidateIn,
		FeedValidateOut,
		FetchLogOut,
		FilterIn,
		FilterOut,
		FolderIn,
		FolderOut,
		PluginSettingsIn,
		PluginSettingsOut,
		SearchResult,
		UserOut,
	)
	from backend.scheduler import start_scheduler
	from backend.security import hash_password
	from backend.services import ConfigStore
	from backend.static_mounts import mount_cache_static, mount_frontend_static

app = create_app()
app.include_router(auth_router)


def _get_or_create_admin(db: Session) -> User:
	user = db.query(User).filter(User.email == settings.admin_email).first()
	if user:
		return user
	user = User(
		email=settings.admin_email,
		password_hash=hash_password(settings.admin_password),
		settings_json=json.dumps({}),
	)
	db.add(user)
	db.commit()
	db.refresh(user)
	return user


def _normalize_plugin_names(values: list[str]) -> list[str]:
	seen: set[str] = set()
	ordered: list[str] = []
	for raw in values:
		name = str(raw).strip()
		if not name or name in seen:
			continue
		seen.add(name)
		ordered.append(name)
	return ordered


def _resolve_enabled_plugins(user: User) -> list[str]:
	available = set(list_available_plugins())
	baseline = _normalize_plugin_names(settings.plugins.split(","))
	stored = ConfigStore.get(user, "enabled_plugins", None)
	if isinstance(stored, list):
		merged = _normalize_plugin_names([*baseline, *_normalize_plugin_names(stored)])
		return [name for name in merged if name in available]
	return [
		name
		for name in baseline
		if name in available
	]


DEFAULT_TIME_FORMAT = "YYYY-MM-DD HH:mm:ss"
TIME_FORMAT_PATTERN = re.compile(r"^[YMDHms:/.\-\s]+$")


def _normalize_time_format(raw: object) -> str:
	value = str(raw or "").strip()
	if not value:
		return DEFAULT_TIME_FORMAT
	if len(value) > 64:
		value = value[:64]
	if not TIME_FORMAT_PATTERN.match(value):
		return DEFAULT_TIME_FORMAT
	if not any(token in value for token in ("YYYY", "MM", "DD", "HH", "mm", "ss")):
		return DEFAULT_TIME_FORMAT
	return value


def _apply_plugin_settings_to_runtime(user: User) -> None:
	enabled = _resolve_enabled_plugins(user)
	object.__setattr__(settings, "plugins", ",".join(enabled))


def _ensure_feed_icon(feed: Feed) -> bool:
	if feed.icon_url:
		return False
	source = feed.site_url or feed.url
	if not source:
		return False
	icon_url = cache_identicon(source)
	if not icon_url:
		return False
	feed.icon_url = icon_url
	return True


def _refresh_feed_icon(feed: Feed) -> bool:
	source = feed.site_url or feed.url
	if not source:
		return False
	icon_url = cache_site_favicon(source)
	if not icon_url:
		return False
	changed = icon_url != feed.icon_url
	feed.icon_url = icon_url
	return changed


def _process_feed_in_background(feed_id: int, user_id: int) -> None:
	with SessionLocal() as db:
		feed = db.query(Feed).filter(Feed.user_id == user_id, Feed.id == feed_id).first()
		if not feed:
			return
		process_feed(db, feed)
		db.commit()


def _shutdown_scheduler_instance(scheduler) -> None:
	if scheduler is None:
		return
	shutdown = getattr(scheduler, "shutdown", None)
	if not callable(shutdown):
		return
	try:
		shutdown(wait=False)
	except Exception:  # noqa: BLE001
		return


@app.on_event("startup")
def on_startup() -> None:
	ensure_secure_runtime_settings()
	ensure_cache_dirs()
	init_db()
	with SessionLocal() as db:
		admin = _get_or_create_admin(db)
		_apply_plugin_settings_to_runtime(admin)
	load_plugins(app)
	mount_frontend_static(app)
	if not settings.testing:
		app.state.scheduler = start_scheduler()


@app.on_event("shutdown")
def on_shutdown() -> None:
	_shutdown_scheduler_instance(getattr(app.state, "scheduler", None))
	app.state.scheduler = None


@app.get("/api/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
	return UserOut(id=user.id, email=user.email)


@app.get("/api/settings/general", response_model=AppSettingsOut)
def get_general_settings(user: User = Depends(get_current_user)) -> AppSettingsOut:
	return AppSettingsOut(
		default_fetch_interval_min=int(
			ConfigStore.get(user, "default_fetch_interval_min", 30)
		),
		fulltext_enabled=bool(
			ConfigStore.get(user, "fulltext_enabled", settings.fulltext_enabled)
		),
		cleanup_retention_days=int(
			ConfigStore.get(user, "cleanup_retention_days", 30)
		),
		cleanup_keep_content=bool(
			ConfigStore.get(user, "cleanup_keep_content", True)
		),
		image_cache_enabled=bool(
			ConfigStore.get(user, "image_cache_enabled", False)
		),
		auto_refresh_interval_sec=max(
			0,
			min(int(ConfigStore.get(user, "auto_refresh_interval_sec", 0)), 86400),
		),
		time_format=_normalize_time_format(
			ConfigStore.get(user, "time_format", DEFAULT_TIME_FORMAT),
		),
	)


@app.put("/api/settings/general", response_model=AppSettingsOut)
def update_general_settings(
	payload: AppSettingsIn,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
) -> AppSettingsOut:
	ConfigStore.set(
		user,
		"default_fetch_interval_min",
		max(1, min(payload.default_fetch_interval_min, 1440)),
	)
	ConfigStore.set(user, "fulltext_enabled", payload.fulltext_enabled)
	ConfigStore.set(
		user,
		"cleanup_retention_days",
		max(1, min(payload.cleanup_retention_days, 3650)),
	)
	ConfigStore.set(user, "cleanup_keep_content", payload.cleanup_keep_content)
	ConfigStore.set(user, "image_cache_enabled", payload.image_cache_enabled)
	ConfigStore.set(
		user,
		"auto_refresh_interval_sec",
		max(0, min(payload.auto_refresh_interval_sec, 86400)),
	)
	ConfigStore.set(user, "time_format", _normalize_time_format(payload.time_format))
	db.commit()
	return get_general_settings(user)


@app.get("/api/settings/plugins", response_model=PluginSettingsOut)
def get_plugin_settings(user: User = Depends(get_current_user)) -> PluginSettingsOut:
	return PluginSettingsOut(
		available=list_available_plugins(),
		enabled=_resolve_enabled_plugins(user),
	)


@app.put("/api/settings/plugins", response_model=PluginSettingsOut)
def update_plugin_settings(
	payload: PluginSettingsIn,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
) -> PluginSettingsOut:
	available = set(list_available_plugins())
	enabled = [name for name in _normalize_plugin_names(payload.enabled) if name in available]
	ConfigStore.set(user, "enabled_plugins", enabled)
	_apply_plugin_settings_to_runtime(user)
	db.commit()
	return PluginSettingsOut(
		available=sorted(available),
		enabled=_resolve_enabled_plugins(user),
	)


@app.get("/api/folders", response_model=List[FolderOut])
def list_folders(
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	folders = db.query(Folder).filter(Folder.user_id == user.id).all()
	return [FolderOut(id=f.id, name=f.name, sort_order=f.sort_order) for f in folders]


@app.post("/api/folders", response_model=FolderOut)
def create_folder(
	payload: FolderIn,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	folder = Folder(user_id=user.id, name=payload.name, sort_order=payload.sort_order)
	db.add(folder)
	db.commit()
	db.refresh(folder)
	return FolderOut(id=folder.id, name=folder.name, sort_order=folder.sort_order)


@app.put("/api/folders/{folder_id}", response_model=FolderOut)
def update_folder(
	folder_id: int,
	payload: FolderIn,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	folder = (
		db.query(Folder)
		.filter(Folder.user_id == user.id, Folder.id == folder_id)
		.first()
	)
	if not folder:
		raise HTTPException(status_code=404, detail="Folder not found")
	folder.name = payload.name
	folder.sort_order = payload.sort_order
	db.commit()
	db.refresh(folder)
	return FolderOut(id=folder.id, name=folder.name, sort_order=folder.sort_order)


@app.delete("/api/folders/{folder_id}")
def delete_folder(
	folder_id: int,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	folder = (
		db.query(Folder)
		.filter(Folder.user_id == user.id, Folder.id == folder_id)
		.first()
	)
	if not folder:
		raise HTTPException(status_code=404, detail="Folder not found")
	db.query(Feed).filter(Feed.user_id == user.id, Feed.folder_id == folder_id).update(
		{Feed.folder_id: None}
	)
	db.delete(folder)
	db.commit()
	return {"ok": True}


@app.get("/api/feeds", response_model=List[FeedOut])
def list_feeds(
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	feeds = db.query(Feed).filter(Feed.user_id == user.id).all()
	updated = False
	for feed in feeds:
		updated = _ensure_feed_icon(feed) or updated
	if updated:
		db.commit()
	return [
		FeedOut(
			id=f.id,
			title=f.title,
			url=f.url,
			folder_id=f.folder_id,
			fetch_interval_min=f.fetch_interval_min,
			fulltext_enabled=f.fulltext_enabled,
			cleanup_retention_days=f.cleanup_retention_days,
			cleanup_keep_content=f.cleanup_keep_content,
			image_cache_enabled=f.image_cache_enabled,
			site_url=f.site_url,
			icon_url=f.icon_url,
			last_status=f.last_status,
			error_count=f.error_count,
			disabled=f.disabled,
		)
		for f in feeds
	]


@app.post("/api/feeds/validate", response_model=FeedValidateOut)
async def validate_feed_url(
	payload: FeedValidateIn,
	user: User = Depends(get_current_user),
):
	try:
		async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
			_, body_text = await fetch_text_response_async(client, payload.url)
		parsed = feedparser.parse(body_text)
		feed_info = parsed.get("feed")
		title = None
		site_url = None
		if isinstance(feed_info, dict):
			title = feed_info.get("title")
			site_url = feed_info.get("link")
		if not title and not parsed.entries:
			raise HTTPException(status_code=400, detail="URL 不是有效的 RSS/Atom 订阅源")
		return FeedValidateOut(
			valid=True,
			title=title or payload.url,
			site_url=site_url,
			message="订阅源校验通过",
		)
	except HTTPException:
		raise
	except Exception as exc:  # noqa: BLE001
		raise HTTPException(status_code=400, detail=format_fetch_error(exc)) from exc


@app.post("/api/feeds", response_model=FeedOut)
def create_feed(
	payload: FeedIn,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	feed = Feed(
		user_id=user.id,
		folder_id=payload.folder_id,
		title=payload.title,
		url=payload.url,
		site_url=payload.site_url,
		fetch_interval_min=payload.fetch_interval_min,
		fulltext_enabled=payload.fulltext_enabled,
		cleanup_retention_days=max(1, min(payload.cleanup_retention_days, 3650)),
		cleanup_keep_content=payload.cleanup_keep_content,
		image_cache_enabled=payload.image_cache_enabled,
	)
	db.add(feed)
	_ensure_feed_icon(feed)
	db.commit()
	db.refresh(feed)
	return FeedOut(
		id=feed.id,
		title=feed.title,
		url=feed.url,
		folder_id=feed.folder_id,
		fetch_interval_min=feed.fetch_interval_min,
		fulltext_enabled=feed.fulltext_enabled,
		cleanup_retention_days=feed.cleanup_retention_days,
		cleanup_keep_content=feed.cleanup_keep_content,
		image_cache_enabled=feed.image_cache_enabled,
		site_url=feed.site_url,
		icon_url=feed.icon_url,
		last_status=feed.last_status,
		error_count=feed.error_count,
		disabled=feed.disabled,
	)


@app.put("/api/feeds/{feed_id}", response_model=FeedOut)
def update_feed(
	feed_id: int,
	payload: FeedIn,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.id == feed_id).first()
	if not feed:
		raise HTTPException(status_code=404, detail="Feed not found")
	source_before = feed.site_url or feed.url
	feed.title = payload.title
	feed.url = payload.url
	feed.site_url = payload.site_url
	feed.folder_id = payload.folder_id
	feed.fetch_interval_min = payload.fetch_interval_min
	feed.fulltext_enabled = payload.fulltext_enabled
	feed.cleanup_retention_days = max(1, min(payload.cleanup_retention_days, 3650))
	feed.cleanup_keep_content = payload.cleanup_keep_content
	feed.image_cache_enabled = payload.image_cache_enabled
	source_after = feed.site_url or feed.url
	if source_before != source_after:
		feed.icon_url = None
	_refresh_feed_icon(feed)
	db.commit()
	db.refresh(feed)
	return FeedOut(
		id=feed.id,
		title=feed.title,
		url=feed.url,
		folder_id=feed.folder_id,
		fetch_interval_min=feed.fetch_interval_min,
		fulltext_enabled=feed.fulltext_enabled,
		cleanup_retention_days=feed.cleanup_retention_days,
		cleanup_keep_content=feed.cleanup_keep_content,
		image_cache_enabled=feed.image_cache_enabled,
		site_url=feed.site_url,
		icon_url=feed.icon_url,
		last_status=feed.last_status,
		error_count=feed.error_count,
		disabled=feed.disabled,
	)


@app.delete("/api/feeds/{feed_id}")
def delete_feed(
	feed_id: int,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.id == feed_id).first()
	if not feed:
		raise HTTPException(status_code=404, detail="Feed not found")
	db.delete(feed)
	db.commit()
	return {"ok": True}


@app.get("/api/feeds/unread_counts", response_model=List[FeedUnreadCountOut])
def list_feed_unread_counts(
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	rows = (
		db.query(Entry.feed_id, func.count(UserEntryState.entry_id))
		.join(UserEntryState, UserEntryState.entry_id == Entry.id)
		.filter(UserEntryState.user_id == user.id, UserEntryState.is_read.is_(False))
		.group_by(Entry.feed_id)
		.all()
	)
	return [FeedUnreadCountOut(feed_id=r[0], unread_count=r[1]) for r in rows]


@app.get("/api/entries", response_model=EntryPageOut)
def list_entries(
	state: str = "all",
	feedId: Optional[int] = None,
	folderId: Optional[int] = None,
	cursor: Optional[int] = None,
	limit: int = 40,
	page: int = 1,
	page_size: int = 40,
	sort_by: str = "updated",
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	query = (
		db.query(Entry, UserEntryState)
		.join(UserEntryState, UserEntryState.entry_id == Entry.id)
		.filter(UserEntryState.user_id == user.id)
	)
	if feedId:
		query = query.filter(Entry.feed_id == feedId)
	if folderId is not None:
		query = query.join(Feed, Feed.id == Entry.feed_id).filter(
			Feed.user_id == user.id,
			Feed.folder_id == folderId,
		)
	if state == "unread":
		query = query.filter(UserEntryState.is_read.is_(False))
	if state == "starred":
		query = query.filter(UserEntryState.is_starred.is_(True))
	if state == "later":
		query = query.filter(UserEntryState.is_later.is_(True))

	sort_key = sort_by.lower().strip()
	if sort_key not in {"updated", "title"}:
		raise HTTPException(status_code=400, detail="Invalid sort_by")
	order_fields = (
		[Entry.title.asc(), Entry.id.desc()]
		if sort_key == "title"
		else [Entry.published_at.desc(), Entry.id.desc()]
	)

	if cursor is not None:
		query = query.filter(Entry.id < cursor)
		safe_limit = max(1, min(limit, 100))
		entries = query.order_by(*order_fields).limit(safe_limit + 1).all()
		has_more = len(entries) > safe_limit
		page_entries = entries[:safe_limit]
		current_page = 1
		total_items = len(page_entries)
		total_pages = 1
	else:
		safe_page_size = max(1, min(page_size, 100))
		safe_page = max(1, page)
		total_items = query.count()
		total_pages = max(1, (total_items + safe_page_size - 1) // safe_page_size)
		if safe_page > total_pages:
			safe_page = total_pages
		offset = (safe_page - 1) * safe_page_size
		page_entries = (
			query.order_by(*order_fields).offset(offset).limit(safe_page_size).all()
		)
		has_more = safe_page < total_pages
		current_page = safe_page

	items = [
		EntryOut(
			id=e.id,
			feed_id=e.feed_id,
			title=e.title,
			url=e.url,
			author=e.author,
			published_at=e.published_at,
			summary=e.summary,
			content_html=e.content_html,
			content_text=e.content_text,
			is_read=s.is_read,
			is_starred=s.is_starred,
			is_later=s.is_later,
		)
		for e, s in page_entries
	]
	next_cursor = items[-1].id if has_more and items else None
	return EntryPageOut(
		items=items,
		next_cursor=next_cursor,
		has_more=has_more,
		current_page=current_page,
		total_pages=total_pages,
		total_items=total_items,
	)


@app.get("/api/entries/{entry_id}", response_model=EntryOut)
def get_entry(
	entry_id: int,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	entry_state = (
		db.query(Entry, UserEntryState)
		.join(UserEntryState, UserEntryState.entry_id == Entry.id)
		.filter(UserEntryState.user_id == user.id, Entry.id == entry_id)
		.first()
	)
	if not entry_state:
		raise HTTPException(status_code=404, detail="Entry not found")
	entry, state = entry_state
	return EntryOut(
		id=entry.id,
		feed_id=entry.feed_id,
		title=entry.title,
		url=entry.url,
		author=entry.author,
		published_at=entry.published_at,
		summary=entry.summary,
		content_html=entry.content_html,
		content_text=entry.content_text,
		is_read=state.is_read,
		is_starred=state.is_starred,
		is_later=state.is_later,
	)


def _update_state(db: Session, user: User, entry_id: int, payload: EntryStateUpdate) -> None:
	state = (
		db.query(UserEntryState)
		.filter(UserEntryState.user_id == user.id, UserEntryState.entry_id == entry_id)
		.first()
	)
	if not state:
		raise HTTPException(status_code=404, detail="State not found")
	if payload.is_read is not None:
		state.is_read = payload.is_read
	if payload.is_starred is not None:
		state.is_starred = payload.is_starred
	if payload.is_later is not None:
		state.is_later = payload.is_later


@app.post("/api/entries/{entry_id}/read")
def mark_read(
	entry_id: int,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	_update_state(db, user, entry_id, EntryStateUpdate(is_read=True))
	db.commit()
	return {"ok": True}


@app.post("/api/entries/{entry_id}/unread")
def mark_unread(
	entry_id: int,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	_update_state(db, user, entry_id, EntryStateUpdate(is_read=False))
	db.commit()
	return {"ok": True}


@app.post("/api/entries/{entry_id}/star")
def mark_star(
	entry_id: int,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	_update_state(db, user, entry_id, EntryStateUpdate(is_starred=True))
	db.commit()
	return {"ok": True}


@app.post("/api/entries/{entry_id}/unstar")
def mark_unstar(
	entry_id: int,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	_update_state(db, user, entry_id, EntryStateUpdate(is_starred=False))
	db.commit()
	return {"ok": True}


@app.post("/api/entries/{entry_id}/later")
def mark_later(
	entry_id: int,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	_update_state(db, user, entry_id, EntryStateUpdate(is_later=True))
	db.commit()
	return {"ok": True}


@app.post("/api/entries/{entry_id}/unlater")
def mark_unlater(
	entry_id: int,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	_update_state(db, user, entry_id, EntryStateUpdate(is_later=False))
	db.commit()
	return {"ok": True}


@app.post("/api/entries/batch")
def batch_update(
	payload: BatchStateUpdate,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	for entry_id in payload.entry_ids:
		_update_state(
			db,
			user,
			entry_id,
			EntryStateUpdate(
				is_read=payload.is_read,
				is_starred=payload.is_starred,
				is_later=payload.is_later,
			),
		)
	db.commit()
	return {"ok": True}


@app.get("/api/search", response_model=List[SearchResult])
def search(
	q: str,
	scope: str = "all",
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	scope_key = scope.lower()
	if scope_key not in {"all", "title", "summary", "content"}:
		raise HTTPException(status_code=400, detail="Invalid scope")
	clean_query = q.replace('"', " ").strip()
	if not clean_query:
		return []
	match_query = clean_query
	if scope_key == "title":
		match_query = f'title:"{clean_query}"'
	elif scope_key == "summary":
		match_query = f'summary:"{clean_query}"'
	elif scope_key == "content":
		match_query = f'content_text:"{clean_query}"'
	query = text(
		"""
		SELECT
			entries.id,
			entries.feed_id,
			entries.title,
			entries.summary,
			entries.content_text,
			entries.url,
			user_entry_state.is_read,
			user_entry_state.is_starred,
			user_entry_state.is_later
		FROM entries_fts
		JOIN entries ON entries_fts.rowid = entries.id
		JOIN user_entry_state ON user_entry_state.entry_id = entries.id
		WHERE user_entry_state.user_id = :user_id AND entries_fts MATCH :q
		ORDER BY entries.id DESC
		LIMIT 50
		"""
	)
	try:
		rows = db.execute(query, {"user_id": user.id, "q": match_query}).fetchall()
	except Exception as exc:  # noqa: BLE001
		raise HTTPException(status_code=400, detail=f"Invalid query: {exc}") from exc
	return [
		SearchResult(
			id=r[0],
			feed_id=r[1],
			title=r[2],
			summary=r[3],
			content_text=r[4],
			url=r[5],
			is_read=bool(r[6]),
			is_starred=bool(r[7]),
			is_later=bool(r[8]),
		)
		for r in rows
	]


@app.get("/api/filters", response_model=List[FilterOut])
def list_filters(
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	rules = db.query(FilterRule).filter(FilterRule.user_id == user.id).all()
	return [
		FilterOut(
			id=r.id,
			name=r.name,
			enabled=r.enabled,
			priority=r.priority,
			match_json=r.match_json,
			actions_json=r.actions_json,
		)
		for r in rules
	]


@app.post("/api/filters", response_model=FilterOut)
def create_filter(
	payload: FilterIn,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	rule = FilterRule(
		user_id=user.id,
		name=payload.name,
		enabled=payload.enabled,
		priority=payload.priority,
		match_json=payload.match_json,
		actions_json=payload.actions_json,
	)
	db.add(rule)
	db.commit()
	db.refresh(rule)
	return FilterOut(
		id=rule.id,
		name=rule.name,
		enabled=rule.enabled,
		priority=rule.priority,
		match_json=rule.match_json,
		actions_json=rule.actions_json,
	)


@app.post("/api/opml/import")
def import_opml(
	file: UploadFile = File(...),
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	import xml.etree.ElementTree as ET

	content = file.file.read()
	root = ET.fromstring(content)

	def get_or_create_folder_id(name: str) -> int:
		folder = (
			db.query(Folder)
			.filter(Folder.user_id == user.id, Folder.name == name)
			.first()
		)
		if folder:
			return folder.id
		folder = Folder(user_id=user.id, name=name, sort_order=0)
		db.add(folder)
		db.flush()
		return folder.id

	def upsert_feed(xml_url: str, title: Optional[str], folder_id: Optional[int]) -> None:
		feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.url == xml_url).first()
		if feed:
			if title:
				feed.title = title
			if folder_id is not None:
				feed.folder_id = folder_id
			return
		db.add(
			Feed(
				user_id=user.id,
				folder_id=folder_id,
				title=title or xml_url,
				url=xml_url,
			)
		)

	def walk(parent, folder_id: Optional[int] = None) -> None:
		for outline in parent.findall("outline"):
			title = outline.attrib.get("title") or outline.attrib.get("text")
			xml_url = (
				outline.attrib.get("xmlUrl")
				or outline.attrib.get("xmlurl")
				or outline.attrib.get("url")
			)
			if xml_url:
				upsert_feed(xml_url, title, folder_id)
				continue

			next_folder_id = folder_id
			if title:
				next_folder_id = get_or_create_folder_id(title)
			walk(outline, next_folder_id)

	body = root.find("body")
	if body is not None:
		walk(body, None)
	else:
		walk(root, None)
	db.commit()
	return {"ok": True}


@app.get("/api/opml/export")
def export_opml(
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	import xml.etree.ElementTree as ET

	root = ET.Element("opml", version="1.0")
	body = ET.SubElement(root, "body")
	feeds = db.query(Feed).filter(Feed.user_id == user.id).all()
	for feed in feeds:
		ET.SubElement(
			body,
			"outline",
			text=feed.title,
			title=feed.title,
			type="rss",
			xmlUrl=feed.url,
		)
	xml_bytes = ET.tostring(root, encoding="utf-8")
	return {
		"content": xml_bytes.decode("utf-8"),
		"exported_at": datetime.utcnow().isoformat(),
	}


@app.post("/api/feeds/{feed_id}/fetch")
def fetch_once(
	feed_id: int,
	background: bool = False,
	background_tasks: BackgroundTasks = None,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.id == feed_id).first()
	if not feed:
		raise HTTPException(status_code=404, detail="Feed not found")
	if background and background_tasks is not None:
		background_tasks.add_task(_process_feed_in_background, feed.id, user.id)
		return {"ok": True, "added": 0, "queued": True}
	added = process_feed(db, feed)
	db.commit()
	return {"ok": True, "added": added, "queued": False}


@app.post("/api/debug/feeds/{feed_id}/refresh")
def debug_refresh_feed(
	feed_id: int,
	background: bool = False,
	background_tasks: BackgroundTasks = None,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.id == feed_id).first()
	if not feed:
		raise HTTPException(status_code=404, detail="Feed not found")
	if background and background_tasks is not None:
		background_tasks.add_task(_process_feed_in_background, feed.id, user.id)
		return {
			"ok": True,
			"feed_id": feed.id,
			"added": 0,
			"queued": True,
			"last_status": feed.last_status,
			"error_count": feed.error_count,
			"last_fetch_at": feed.last_fetch_at,
		}
	added = process_feed(db, feed)
	db.commit()
	return {
		"ok": True,
		"feed_id": feed.id,
		"added": added,
		"queued": False,
		"last_status": feed.last_status,
		"error_count": feed.error_count,
		"last_fetch_at": feed.last_fetch_at,
	}


@app.get("/api/debug/feeds/{feed_id}/logs", response_model=List[FetchLogOut])
def debug_feed_logs(
	feed_id: int,
	limit: int = 100,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.id == feed_id).first()
	if not feed:
		raise HTTPException(status_code=404, detail="Feed not found")
	logs = (
		db.query(FetchLog)
		.filter(FetchLog.feed_id == feed_id)
		.order_by(FetchLog.fetched_at.desc())
		.limit(max(1, min(limit, 500)))
		.all()
	)
	return [
		FetchLogOut(
			id=log.id,
			feed_id=log.feed_id,
			status=log.status,
			fetched_at=log.fetched_at,
			error_message=log.error_message,
		)
		for log in logs
	]


@app.get("/api/debug/feeds/{feed_id}/entries", response_model=List[DebugEntryOut])
def debug_feed_entries(
	feed_id: int,
	limit: int = 20,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.id == feed_id).first()
	if not feed:
		raise HTTPException(status_code=404, detail="Feed not found")
	rows = (
		db.query(Entry)
		.filter(Entry.feed_id == feed_id)
		.order_by(Entry.published_at.desc(), Entry.id.desc())
		.limit(max(1, min(limit, 50)))
		.all()
	)
	return [
		DebugEntryOut(
			id=row.id,
			feed_id=row.feed_id,
			title=row.title,
			url=row.url,
			published_at=row.published_at,
			summary=row.summary,
			content_html=row.content_html,
			content_text=row.content_text,
		)
		for row in rows
	]


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
	feeds = db.query(Feed).count()
	entries = db.query(Entry).count()
	failed_feeds = db.query(Feed).filter(Feed.error_count > 0).count()
	logs = db.query(FetchLog).order_by(FetchLog.fetched_at.desc()).limit(100).all()
	if logs:
		successes = sum(1 for log in logs if log.status == 200)
		success_rate = successes / len(logs)
	else:
		success_rate = 0.0
	return {
		"feeds": feeds,
		"entries": entries,
		"failed_feeds": failed_feeds,
		"success_rate": round(success_rate, 3),
		"status": "ok",
	}


@app.get("/api/fetch/logs", response_model=List[FetchLogOut])
def list_fetch_logs(
	feed_id: Optional[int] = None,
	limit: int = 50,
	db: Session = Depends(get_db),
	user: User = Depends(get_current_user),
):
	query = (
		db.query(FetchLog)
		.join(Feed, FetchLog.feed_id == Feed.id)
		.filter(Feed.user_id == user.id)
	)
	if feed_id:
		query = query.filter(FetchLog.feed_id == feed_id)
	logs = query.order_by(FetchLog.fetched_at.desc()).limit(limit).all()
	return [
		FetchLogOut(
			id=log.id,
			feed_id=log.feed_id,
			status=log.status,
			fetched_at=log.fetched_at,
			error_message=log.error_message,
		)
		for log in logs
	]

mount_cache_static(app)
