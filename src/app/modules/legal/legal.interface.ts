export type ILegalPage = {
  id: string;
  title: string;
  slug: string;
  content: string;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type IUpdateLegalPagePayload = {
  title?: string;
  content?: string;
  isPublished?: boolean;
};
