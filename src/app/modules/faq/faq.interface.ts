export interface ICreateFaqPayload {
  question: string;
  answer: string;
  category?: string;
  isPublished?: boolean;
  order?: number;
}

export interface IUpdateFaqPayload {
  question?: string;
  answer?: string;
  category?: string;
  isPublished?: boolean;
  order?: number;
}

export interface IFaqFilterOptions {
  search?: string;
  category?: string;
  isPublished?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
