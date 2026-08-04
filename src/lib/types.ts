export type TransactionType = "INCOME" | "EXPENSE";

export type BusinessArea = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

export type Category = {
  id: string;
  name: string;
  type: TransactionType;
  createdAt: string;
};

export type Transaction = {
  id: string;
  date: string;
  amount: number;
  type: TransactionType;
  description: string | null;
  source: string;
  categoryId: string | null;
  businessAreaId: string | null;
  category: Category | null;
  businessArea: BusinessArea | null;
  createdAt: string;
};

export type Summary = {
  totals: { income: number; expense: number; profit: number };
  expensesByCategory: { name: string; total: number; count: number }[];
  businessAreas: { name: string; income: number; expense: number; profit: number }[];
  transactionCount: number;
};
