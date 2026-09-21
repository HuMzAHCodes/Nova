import Task from '../models/Task.js';
import { AppError } from '../lib/AppError.js';
import { CreateTaskInput, UpdateTaskInput, TASK_ALLOWED_SORT_FIELDS } from '../validators/taskValidators.js';
import { PaginationQuery } from '../validators/paginationValidators.js';

// CONCEPT: task-model-design + multi-tenancy-and-architecture. Every
// function here takes tenantId as an explicit, required parameter and
// filters by it — same tenant-safety pattern as projectService.

export async function create(tenantId: string, projectId: string, input: CreateTaskInput) {
  const task = await Task.create({
    organizationId: tenantId,
    projectId,
    ...input,
  });
  return task;
}

export async function findById(tenantId: string, taskId: string) {
  // Filtering by BOTH _id and organizationId — a task ID belonging to a
  // different org returns null (treated as "not found"), never leaking
  // that it exists at all. Same pattern as projectService.findById.
  const task = await Task.findOne({ _id: taskId, organizationId: tenantId });
  if (!task) {
    throw new AppError(404, 'Task not found');
  }
  return task;
}

// CONCEPT: rest-crud-design (pagination/filtering/sorting). Lists all
// tasks for a specific project — note this is scoped by BOTH tenantId
// AND projectId, since "all tasks" always means "all tasks in this one
// project," not every task across the whole org.
export async function listForProject(tenantId: string, projectId: string, query: PaginationQuery) {
  const { page, limit, sort } = query;
  const skip = (page - 1) * limit;

  let sortObj: Record<string, 1 | -1> = { createdAt: -1 }; // safe default
  if (sort) {
    const direction: 1 | -1 = sort.startsWith('-') ? -1 : 1;
    const field = sort.replace(/^-/, '');
    if ((TASK_ALLOWED_SORT_FIELDS as readonly string[]).includes(field)) {
      sortObj = { [field]: direction };
    }
  }

  const filter = { organizationId: tenantId, projectId };

  const [tasks, total] = await Promise.all([
    Task.find(filter).sort(sortObj).skip(skip).limit(limit),
    Task.countDocuments(filter),
  ]);

  return {
    tasks,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function update(tenantId: string, taskId: string, input: UpdateTaskInput) {
  const task = await Task.findOneAndUpdate(
    { _id: taskId, organizationId: tenantId },
    { $set: input },
    { new: true, runValidators: true }
  );

  if (!task) {
    throw new AppError(404, 'Task not found');
  }

  return task;
}

export async function remove(tenantId: string, taskId: string) {
  const task = await Task.findOneAndDelete({ _id: taskId, organizationId: tenantId });
  if (!task) {
    throw new AppError(404, 'Task not found');
  }
}