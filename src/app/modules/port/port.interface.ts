export interface ICreatePortPayload {
  name: string;
  isActive?: boolean;
}

export interface IUpdatePortPayload {
  name?: string;
  isActive?: boolean;
}

export interface IPortFilterOptions {
  search?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}
