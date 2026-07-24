# Troubleshooting: MongoDB Atlas Connection Failure (SRV DNS Resolution)

A detailed record of a real connection issue hit while setting up MongoDB Atlas for Nova, every approach tried, and what actually fixed it — kept as a standalone reference for future debugging (this exact class of issue is common enough on Windows to resurface on other projects).

---

## The symptom

Running the backend for the first time, after correctly setting up MongoDB Atlas (cluster created, database user created, `0.0.0.0/0` added to the IP access list, connection string pasted into `.env`):

```
npm run dev

MongoDB connection failed: querySrv ECONNREFUSED _mongodb._tcp.firstnovacluster.swoan6t.mongodb.net
```

The app itself booted fine (env validation passed, Express was ready) — it was specifically the MongoDB connection attempt that failed, and it failed at the DNS resolution step, before ever reaching Atlas's servers.

## Why this error happens — the underlying mechanism

MongoDB Atlas's default connection string uses the `mongodb+srv://` protocol, e.g.:
```
mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/dbname
```
This format doesn't point directly at a server — instead, the MongoDB driver performs a **DNS SRV lookup** (a special DNS record type used to discover a list of servers, ports, and priorities for a service) against `_mongodb._tcp.<cluster-address>` to find the actual replica set members before connecting. This is convenient because it means Atlas can change the underlying servers without you ever needing to update your connection string.

The failure (`querySrv ECONNREFUSED`) means: the attempt to look up that SRV record was refused — not that MongoDB itself refused the connection, but that the *DNS query for the SRV record* never got a valid response.

## What was ruled out, step by step

**1. Typo or malformed connection string** — checked the string character by character against what Atlas provided. Ruled out.

**2. IP not whitelisted in Atlas Network Access** — confirmed `0.0.0.0/0` was present and active in the IP Access List. Ruled out.

**3. Wrong project / stale cluster from a previous project** — created a fresh "NOVA" project in Atlas with its own new cluster and new database user, to eliminate any chance of cross-project confusion. Issue persisted. Ruled out.

**4. ISP/ router-level DNS blocking** — changed the machine's DNS servers from automatic/ISP-provided to Google's public DNS (`8.8.8.8` / `8.8.4.4`), via Control Panel → Network Connections → IPv4 Properties, with **"Obtain an IP address automatically"** kept selected (only DNS servers overridden, not the IP itself). Flushed the DNS cache (`ipconfig /flushdns`) and restarted the terminal/VS Code entirely. Issue persisted. This made ISP-level blocking look less likely, but wasn't fully conclusive yet.

**5. Testing on a completely different network** — connected via a phone's mobile hotspot instead of home wifi, as a clean test of whether it was network-specific. Issue persisted identically. This **ruled out the ISP/network as the cause entirely** — the problem had to be local to the machine itself, specifically at the Node.js level (since the failure was consistent across two unrelated networks).

**6. Isolating to Node's DNS resolver specifically** — ran a minimal, standalone test bypassing the app entirely:
```powershell
node -e "require('dns').resolveSrv('_mongodb._tcp.firstnovacluster.swoan6t.mongodb.net', (err, addr) => console.log(err || addr))"
```
This failed with the exact same `ECONNREFUSED` error, confirming the issue was **Node.js's own DNS resolver failing specifically on SRV record queries** — a known class of issue on some Windows machines, related to how Node's underlying DNS library (`c-ares`) handles SRV lookups differently from how the OS itself resolves regular DNS (`A`/`AAAA`) records.

To confirm this precisely — that it was SRV-specific, not DNS-general — two further tests were run:
```powershell
# Plain DNS lookup (not SRV) for one of the actual shard servers
node -e "require('dns').lookup('ac-inn2fpl-shard-00-00.swoan6t.mongodb.net', (err, addr) => console.log(err || addr))"
# → succeeded, returned an IP address

# Direct TCP connection test to the same server on MongoDB's port
Test-NetConnection ac-inn2fpl-shard-00-00.swoan6t.mongodb.net -Port 27017
# → TcpTestSucceeded : True
```
Both succeeded. This proved: regular DNS worked, the network path to the actual database servers worked, and only the **SRV record query mechanism itself** was broken on this machine.

## The actual fix

Since only SRV resolution was broken — and everything else worked — the fix was to **stop relying on SRV resolution entirely**, by switching from the SRV connection string format to the **standard, multi-host connection string format**, which lists each replica set member's hostname and port directly instead of asking DNS to discover them.

**Step 1 — get the real hostnames behind the SRV record**, using an external tool that performs the DNS query from outside the local machine/network (Google's own DNS lookup tool, unaffected by the local Node/Windows issue):
- `https://toolbox.googleapps.com/apps/dig/#SRV/`
- Query: `_mongodb._tcp.firstnovacluster.swoan6t.mongodb.net`
- Returned three hostnames, each on port 27017:
  ```
  ac-inn2fpl-shard-00-00.swoan6t.mongodb.net.
  ac-inn2fpl-shard-00-01.swoan6t.mongodb.net.
  ac-inn2fpl-shard-00-02.swoan6t.mongodb.net.
  ```

**Step 2 — construct the standard connection string manually**, listing all three hosts directly:
```
mongodb://<username>:<password>@ac-inn2fpl-shard-00-00.swoan6t.mongodb.net:27017,ac-inn2fpl-shard-00-01.swoan6t.mongodb.net:27017,ac-inn2fpl-shard-00-02.swoan6t.mongodb.net:27017/<dbname>?ssl=true&authSource=admin&retryWrites=true&w=majority
```

**Step 3 — fix a second, related bug this surfaced:** the app's own environment validation (`config/env.ts`) used `z.string().url()` to validate `MONGODB_URI`. The standard multi-host format is *not* a spec-valid URL (comma-separated hosts aren't standard URL syntax), so the strict validator rejected an otherwise-correct connection string with `Invalid url`. Fixed by relaxing the validation to a regex checking only for the correct protocol prefix:
```ts
MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must start with mongodb:// or mongodb+srv://'),
```

**Step 4 — a second false start after switching formats:** once validation passed, the connection attempt still failed, this time with `Server selection timed out after 30000 ms` — despite DNS and TCP both confirmed working for all three hosts. The cause: the connection string initially included a guessed `replicaSet=atlas-inn2fpl-shard-0` parameter. When a connection string's `replicaSet` name doesn't exactly match what the servers themselves report, the MongoDB driver silently treats every server as "not part of the expected replica set" and excludes all of them — which looks identical to a timeout, even though every host is reachable. **Fix: removed the `replicaSet` parameter entirely**, letting the driver auto-discover the replica set topology directly from the servers instead of requiring it to be specified upfront.

**Final working connection string shape:**
```
mongodb://<username>:<password>@host1:27017,host2:27017,host3:27017/<dbname>?ssl=true&authSource=admin&retryWrites=true&w=majority
```

## Key lessons (for future debugging of similar issues)

1. **When a connection fails at DNS resolution, test DNS and the actual network path separately, and outside the app.** Isolating with raw `node -e` one-liners for `dns.resolveSrv` vs `dns.lookup` vs `Test-NetConnection` narrowed the problem down precisely, rather than guessing at network/firewall/ISP causes.
2. **Testing on a second, unrelated network (mobile hotspot) is one of the fastest ways to rule out ISP/router causes.** If a failure persists across two completely different networks, the problem is local to the machine.
3. **SRV-based DNS resolution and regular DNS resolution are handled differently by Node.js under the hood**, and can fail independently of each other — a working `ping` or working browser internet access does not guarantee `dns.resolveSrv` works.
4. **Overly strict input validation can produce misleading errors that look like the "real" problem.** The `z.string().url()` rejection wasn't the actual bug — it just surfaced once the actual fix (switching connection string formats) was already in progress, and needed its own fix.
5. **A `replicaSet` mismatch produces the same symptom as a genuine network timeout** (server selection timeout), even though the actual servers are perfectly reachable — this is a notoriously confusing failure mode, since nothing about the error message points at the connection string's `replicaSet` parameter specifically.