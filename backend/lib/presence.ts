// CONCEPT: presence. Who is currently looking at a project.
//
// A user is "present" in a project while at least one of their sockets has
// joined that project's room. One person can have several sockets (two
// tabs, phone and laptop), so presence is counted per PERSON: they become
// present when their first socket joins and absent when their last one goes.
//
// The store sits behind a small interface so the in-memory version used
// today can be swapped for a Redis version (Phase E) without touching the
// socket code that uses it. Every method is async for that reason, even
// though the in-memory version never waits.

export interface PresenceEntry {
  _id: string;
  name: string;
  role: string;
}

export interface PresenceStore {
  // Records that this socket is in the project. Returns true when the person
  // was NOT present before (their first socket), false for an extra tab or a
  // repeated join.
  add(projectId: string, entry: PresenceEntry, socketId: string): Promise<boolean>;

  // Records that this socket left the project. Returns the entry when that
  // was the person's LAST socket there (they are now absent), otherwise null.
  remove(projectId: string, userId: string, socketId: string): Promise<PresenceEntry | null>;

  // Everyone present in the project right now.
  list(projectId: string): Promise<PresenceEntry[]>;
}

interface PresentPerson {
  entry: PresenceEntry;
  socketIds: Set<string>;
}

// In-memory store: project id -> user id -> the person and their sockets.
// It lives in one server process and is empty after a restart.
export function createInMemoryPresenceStore(): PresenceStore {
  const peopleByProject = new Map<string, Map<string, PresentPerson>>();

  return {
    async add(projectId, entry, socketId) {
      let people = peopleByProject.get(projectId);
      if (!people) {
        people = new Map();
        peopleByProject.set(projectId, people);
      }
      const existing = people.get(entry._id);
      if (existing) {
        existing.socketIds.add(socketId);
        return false;
      }
      people.set(entry._id, { entry, socketIds: new Set([socketId]) });
      return true;
    },

    async remove(projectId, userId, socketId) {
      const people = peopleByProject.get(projectId);
      const person = people?.get(userId);
      if (!people || !person) return null;

      person.socketIds.delete(socketId);
      if (person.socketIds.size > 0) return null;

      people.delete(userId);
      if (people.size === 0) peopleByProject.delete(projectId);
      return person.entry;
    },

    async list(projectId) {
      const people = peopleByProject.get(projectId);
      return people ? Array.from(people.values(), (person) => person.entry) : [];
    },
  };
}

// CONCEPT: presence (who sees whom). Staff see everyone; a client sees only
// staff, never other clients. The viewer is never listed to themselves.
export function visibleEntriesFor(
  viewer: { _id: string; role: string },
  entries: PresenceEntry[]
): PresenceEntry[] {
  return entries.filter((entry) => {
    if (entry._id === viewer._id) return false;
    if (viewer.role === 'client' && entry.role === 'client') return false;
    return true;
  });
}
