from __future__ import annotations

import time

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    settings_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)

    folders: Mapped[list["Folder"]] = relationship("Folder", back_populates="user")
    feeds: Mapped[list["Feed"]] = relationship("Feed", back_populates="user")


class Folder(Base):
    __tablename__ = "folders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="folders")
    feeds: Mapped[list["Feed"]] = relationship("Feed", back_populates="folder")


class Feed(Base):
    __tablename__ = "feeds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    folder_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("folders.id"), nullable=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False)
    site_url: Mapped[str | None] = mapped_column(String, nullable=True)
    icon_url: Mapped[str | None] = mapped_column(String, nullable=True)
    etag: Mapped[str | None] = mapped_column(String, nullable=True)
    last_modified: Mapped[str | None] = mapped_column(String, nullable=True)
    fetch_interval_min: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    last_fetch_at: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_status: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    fulltext_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    cleanup_retention_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    cleanup_keep_content: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    image_cache_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="feeds")
    folder: Mapped["Folder | None"] = relationship("Folder", back_populates="feeds")
    entries: Mapped[list["Entry"]] = relationship("Entry", back_populates="feed")


class Entry(Base):
    __tablename__ = "entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    feed_id: Mapped[int] = mapped_column(Integer, ForeignKey("feeds.id"), nullable=False)
    guid: Mapped[str | None] = mapped_column(String, nullable=True)
    url: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    author: Mapped[str | None] = mapped_column(String, nullable=True)
    published_at: Mapped[int] = mapped_column(
        Integer,
        default=lambda: int(time.time()),
    )
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    hash: Mapped[str] = mapped_column(String, nullable=False)

    feed: Mapped["Feed"] = relationship("Feed", back_populates="entries")

    __table_args__ = (
        UniqueConstraint("feed_id", "hash", name="uq_entries_feed_hash"),
    )


class UserEntryState(Base):
    __tablename__ = "user_entry_state"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), primary_key=True)
    entry_id: Mapped[int] = mapped_column(Integer, ForeignKey("entries.id"), primary_key=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_starred: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_later: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    read_at: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class FetchLog(Base):
    __tablename__ = "fetch_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    feed_id: Mapped[int] = mapped_column(Integer, ForeignKey("feeds.id"), nullable=False)
    status: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    fetched_at: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class AuthRefreshToken(Base):
    __tablename__ = "auth_refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    issued_at: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    expires_at: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    revoked_at: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)
    ip: Mapped[str | None] = mapped_column(String, nullable=True)


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str | None] = mapped_column(String, nullable=True)


class FeedTag(Base):
    __tablename__ = "feed_tags"

    feed_id: Mapped[int] = mapped_column(Integer, ForeignKey("feeds.id"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(Integer, ForeignKey("tags.id"), primary_key=True)


class EntryTag(Base):
    __tablename__ = "entry_tags"

    entry_id: Mapped[int] = mapped_column(Integer, ForeignKey("entries.id"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(Integer, ForeignKey("tags.id"), primary_key=True)


class FilterRule(Base):
    __tablename__ = "filters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    match_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    actions_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
