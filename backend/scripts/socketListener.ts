import 'dotenv/config';
import { io } from 'socket.io-client';

// Testing tool: connects to the local Socket.io server as an authenticated
// internal user, joins one project's room, and prints every
// deliverable:statusChanged event it receives. Used to verify the real-time
// layer end to end: run this, then approve or reject a deliverable through
// the client portal API and watch the event arrive here.
//
// Usage (from the backend folder):
//   npx tsx scripts/socketListener.ts "<accessToken>" <projectId>
//
// The token only has to be valid at the moment of connecting: the server
// verifies it once per connection, not on every event.
//
// Standalone on purpose: it does not import config/env.ts.

const [token, projectId] = process.argv.slice(2);

if (!token || !projectId) {
  console.error('Usage: npx tsx scripts/socketListener.ts "<accessToken>" <projectId>');
  process.exit(1);
}

const port = process.env.PORT ?? '5000';
const socket = io(`http://localhost:${port}`, { auth: { token } });

socket.on('connect', () => {
  console.log(`Connected (socket ${socket.id})`);
  socket.emit('joinProject', projectId);
  console.log(`Asked to join room project:${projectId}. Waiting for events (Ctrl+C to stop)...`);
});

socket.on('connect_error', (error) => {
  console.error(`Connection failed: ${error.message}`);
  process.exit(1);
});

socket.on('deliverable:statusChanged', (payload: unknown) => {
  console.log(`Received deliverable:statusChanged -> ${JSON.stringify(payload)}`);
});

socket.on('disconnect', (reason) => {
  console.log(`Disconnected: ${reason}`);
});
