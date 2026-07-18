export type TaskPriority = "low" | "normal" | "high";

export type TaskStatus = "pending" | "in_progress" | "completed";

export type Task = {
  id: number;
  title: string;
  description: string | null;
  clientId: number | null;
  clientName: string | null;
  clientIsArchived: boolean;
  priority: TaskPriority;
  status: TaskStatus;
  scheduledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskInput = {
  title: string;
  description: string | null;
  clientId: number | null;
  priority: TaskPriority;
  status: TaskStatus;
  scheduledAt: string | null;
};
