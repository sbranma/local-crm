import { invoke } from "@tauri-apps/api/core";
import type { Task, TaskInput, TaskStatus } from "./task.types";

export function createTask(input: TaskInput): Promise<Task> {
  return invoke<Task>("create_task", { input });
}

export function listTasks(): Promise<Task[]> {
  return invoke<Task[]>("list_tasks");
}

export function updateTask(id: number, input: TaskInput): Promise<Task> {
  return invoke<Task>("update_task", { id, input });
}

export function setTaskStatus(id: number, status: TaskStatus): Promise<Task> {
  return invoke<Task>("set_task_status", { id, status });
}

export function deleteTask(id: number): Promise<void> {
  return invoke<void>("delete_task", { id });
}
