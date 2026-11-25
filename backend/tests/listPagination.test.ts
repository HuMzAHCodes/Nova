import { describe, it, expect } from 'vitest';
import { api, bearer, makeTenant, makeProject, makeUser } from './helpers.js';
import Task from '../models/Task.js';
import Project from '../models/Project.js';

// CONCEPT: characterization-testing (pagination and sorting). The task list
// and the project list share one query schema and the same paging and
// sorting rules. They worked but had no automated tests. The same cases run
// against both lists.

const ITEM_COUNT = 25;
const BASE_TIME = new Date('2030-01-01T00:00:00.000Z').getTime();
const itemName = (index: number) => `Item ${String(index).padStart(2, '0')}`;

interface ListSetup {
  // The list URL for the tenant's owner to call.
  url: string;
  // The key holding the items in `data`.
  dataKey: 'tasks' | 'projects';
  // The field that holds the readable name, and the allowed sort field for it.
  nameField: 'title' | 'name';
}

interface ListKind {
  label: string;
  setUp: () => Promise<ListSetup & { owner: Awaited<ReturnType<typeof makeTenant>>['owner']; member: Awaited<ReturnType<typeof makeUser>>; client: Awaited<ReturnType<typeof makeUser>> }>;
}

// Item 01 is the oldest, item 25 the newest. Another organization (and, for
// tasks, another project) gets items too: they must never show up.
const kinds: ListKind[] = [
  {
    label: 'task list',
    async setUp() {
      const { org, owner } = await makeTenant();
      const project = await makeProject(org._id);
      const otherProject = await makeProject(org._id, 'Other project');
      const member = await makeUser(org._id, 'member');
      const client = await makeUser(org._id, 'client');
      for (let index = 1; index <= ITEM_COUNT; index++) {
        await Task.create({
          organizationId: org._id,
          projectId: project._id,
          title: itemName(index),
          dueDate: new Date(BASE_TIME + (ITEM_COUNT - index) * 1000),
          createdAt: new Date(BASE_TIME + index * 1000),
        });
      }
      await Task.create({ organizationId: org._id, projectId: otherProject._id, title: 'Task of another project' });
      const outsider = await makeTenant();
      const outsiderProject = await makeProject(outsider.org._id);
      await Task.create({ organizationId: outsider.org._id, projectId: outsiderProject._id, title: 'Task of another organization' });
      return { url: `/api/projects/${project._id}/tasks`, dataKey: 'tasks', nameField: 'title', owner, member, client };
    },
  },
  {
    label: 'project list',
    async setUp() {
      const { org, owner } = await makeTenant();
      const member = await makeUser(org._id, 'member');
      const client = await makeUser(org._id, 'client');
      for (let index = 1; index <= ITEM_COUNT; index++) {
        await Project.create({ organizationId: org._id, name: itemName(index), createdAt: new Date(BASE_TIME + index * 1000) });
      }
      const outsider = await makeTenant();
      await Project.create({ organizationId: outsider.org._id, name: 'Project of another organization' });
      return { url: `/api/organizations/${org._id}/projects`, dataKey: 'projects', nameField: 'name', owner, member, client };
    },
  },
];

describe.each(kinds)('$label: paging', ({ setUp }) => {
  it('the first page has 20 newest items and correct totals', async () => {
    const { url, dataKey, nameField, owner } = await setUp();
    const res = await api().get(url).set(bearer(owner));
    expect(res.status).toBe(200);
    const items = res.body.data[dataKey];
    expect(items).toHaveLength(20);
    expect(items[0][nameField]).toBe(itemName(25));
    expect(items[19][nameField]).toBe(itemName(6));
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: ITEM_COUNT, totalPages: 2 });
  });

  it('the second page holds the rest', async () => {
    const { url, dataKey, nameField, owner } = await setUp();
    const res = await api().get(`${url}?page=2`).set(bearer(owner));
    const items = res.body.data[dataKey];
    expect(items.map((item: Record<string, string>) => item[nameField])).toEqual([5, 4, 3, 2, 1].map(itemName));
    expect(res.body.pagination.page).toBe(2);
  });

  it('limit sets the page size and totalPages rounds up', async () => {
    const { url, dataKey, owner } = await setUp();
    const res = await api().get(`${url}?limit=10&page=3`).set(bearer(owner));
    expect(res.body.data[dataKey]).toHaveLength(5);
    expect(res.body.pagination).toEqual({ page: 3, limit: 10, total: ITEM_COUNT, totalPages: 3 });
  });

  it('all pages together contain every item exactly once', async () => {
    const { url, dataKey, nameField, owner } = await setUp();
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await api().get(`${url}?limit=10&page=${page}&sort=${nameField}`).set(bearer(owner));
      seen.push(...res.body.data[dataKey].map((item: Record<string, string>) => item[nameField]));
    }
    expect(seen).toEqual(Array.from({ length: ITEM_COUNT }, (_unused, index) => itemName(index + 1)));
  });

  it('a page past the end is empty but still reports the totals', async () => {
    const { url, dataKey, owner } = await setUp();
    const res = await api().get(`${url}?page=9`).set(bearer(owner));
    expect(res.status).toBe(200);
    expect(res.body.data[dataKey]).toEqual([]);
    expect(res.body.pagination.total).toBe(ITEM_COUNT);
  });

  it('the largest allowed page size is 100', async () => {
    const { url, dataKey, owner } = await setUp();
    const res = await api().get(`${url}?limit=100`).set(bearer(owner));
    expect(res.status).toBe(200);
    expect(res.body.data[dataKey]).toHaveLength(ITEM_COUNT);
  });

  it.each([
    ['a limit of 101', 'limit=101'],
    ['a limit of 0', 'limit=0'],
    ['a negative limit', 'limit=-5'],
    ['a limit that is not a number', 'limit=lots'],
    ['a limit that is not a whole number', 'limit=1.5'],
    ['page 0', 'page=0'],
    ['a negative page', 'page=-1'],
    ['a page that is not a number', 'page=first'],
    ['a page that is not a whole number', 'page=1.5'],
  ])('%s is a 400', async (_label, query) => {
    const { url, owner } = await setUp();
    const res = await api().get(`${url}?${query}`).set(bearer(owner));
    expect(res.status).toBe(400);
  });

  it('only this organization (and, for tasks, this project) is counted and listed', async () => {
    const { url, dataKey, nameField, owner } = await setUp();
    const res = await api().get(`${url}?limit=100`).set(bearer(owner));
    expect(res.body.pagination.total).toBe(ITEM_COUNT);
    const names = res.body.data[dataKey].map((item: Record<string, string>) => item[nameField]);
    expect(names.every((name: string) => name.startsWith('Item '))).toBe(true);
  });
});

describe.each(kinds)('$label: sorting', ({ setUp }) => {
  const firstNameOf = (res: { body: { data: Record<string, Record<string, string>[]> } }, dataKey: string, nameField: string) =>
    res.body.data[dataKey][0][nameField];

  it('with no sort, the newest item comes first', async () => {
    const { url, dataKey, nameField, owner } = await setUp();
    const res = await api().get(url).set(bearer(owner));
    expect(firstNameOf(res, dataKey, nameField)).toBe(itemName(25));
  });

  it('sort by the name field ascending, and with a minus descending', async () => {
    const { url, dataKey, nameField, owner } = await setUp();
    const ascending = await api().get(`${url}?sort=${nameField}`).set(bearer(owner));
    expect(firstNameOf(ascending, dataKey, nameField)).toBe(itemName(1));
    const descending = await api().get(`${url}?sort=-${nameField}`).set(bearer(owner));
    expect(firstNameOf(descending, dataKey, nameField)).toBe(itemName(25));
  });

  it('sort by createdAt ascending puts the oldest first, descending the newest', async () => {
    const { url, dataKey, nameField, owner } = await setUp();
    const ascending = await api().get(`${url}?sort=createdAt`).set(bearer(owner));
    expect(firstNameOf(ascending, dataKey, nameField)).toBe(itemName(1));
    const descending = await api().get(`${url}?sort=-createdAt`).set(bearer(owner));
    expect(firstNameOf(descending, dataKey, nameField)).toBe(itemName(25));
  });

  it('an unknown or private field is not used: the answer is 200 in the default order', async () => {
    const { url, dataKey, nameField, owner } = await setUp();
    for (const sort of ['organizationId', '-passwordHash', 'nonsense', '$where', '']) {
      const res = await api().get(`${url}?sort=${encodeURIComponent(sort)}`).set(bearer(owner));
      expect(res.status).toBe(200);
      expect(firstNameOf(res, dataKey, nameField)).toBe(itemName(25));
    }
  });
});

describe('task list: sorting by due date and status', () => {
  it('sort by dueDate ascending puts the earliest due date first', async () => {
    const { url, owner } = await kinds[0].setUp();
    const ascending = await api().get(`${url}?sort=dueDate`).set(bearer(owner));
    // item 25 was given the earliest due date, item 01 the latest
    expect(ascending.body.data.tasks[0].title).toBe(itemName(25));
    const descending = await api().get(`${url}?sort=-dueDate`).set(bearer(owner));
    expect(descending.body.data.tasks[0].title).toBe(itemName(1));
  });
});

describe('who may call the lists', () => {
  it('a member can list; a client cannot; no token is a 401', async () => {
    for (const kind of kinds) {
      const { url, member, client } = await kind.setUp();
      expect((await api().get(url).set(bearer(member))).status).toBe(200);
      expect((await api().get(url).set(bearer(client))).status).toBe(403);
      expect((await api().get(url)).status).toBe(401);
    }
  });
});

// The task list filters by organization AND project. Through the routes the
// project check already blocks another organization, so this is the second
// lock: the service itself must also refuse to return a project's tasks to
// the wrong organization.
describe('task list service: the organization filter is a lock of its own', () => {
  it('returns nothing when the project belongs to a different organization', async () => {
    const taskService = await import('../services/taskService.js');
    const { org } = await makeTenant();
    const project = await makeProject(org._id);
    await Task.create({ organizationId: org._id, projectId: project._id, title: 'Secret task' });
    const outsider = await makeTenant();

    const result = await taskService.listForProject(String(outsider.org._id), String(project._id), {
      page: 1,
      limit: 20,
    });

    expect(result.tasks).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
  });
});
