export type ILegalPage = {
  id: string;
  title: string;
  slug: string;
  content: string;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ICreateLegalPagePayload = {
  title: string;
  slug?: string;
  content: string;
  isPublished?: boolean;
};

export type IUpdateLegalPagePayload = {
  title?: string;
  slug?: string;
  content?: string;
  isPublished?: boolean;
};
