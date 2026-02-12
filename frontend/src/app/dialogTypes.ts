export type FolderDeleteStep = "confirm" | "mode";

export interface FeedDeleteDialogState {
  feedId: number;
  feedTitle: string;
}

export interface FolderDeleteDialogState {
  folderId: number;
  folderName: string;
  feedsInFolder: number[];
  step: FolderDeleteStep;
}
