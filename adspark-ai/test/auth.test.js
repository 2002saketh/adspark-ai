import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { OAuth2Client } from "google-auth-library";
import test, { after } from "node:test";

const databasePath = join(tmpdir(), `adspark-auth-${randomUUID()}.sqlite`);
process.env.AUTH_DB_PATH = databasePath;
process.env.APP_ORIGIN = "http://localhost:5173";

const auth = await import("../server/auth.js");

after(async () => {
  auth.closeAuthDatabase();
  await rm(databasePath, { force: true });
  await rm(`${databasePath}-shm`, { force: true });
  await rm(`${databasePath}-wal`, { force: true });
});

test("the same Google sub resolves to the same AdSpark user", async () => {
  const first = await auth.upsertGoogleUser({
    sub: "google-stable-sub-for-test",
    email: "first@example.test",
    name: "First Name",
    picture: "https://example.test/profile.png",
  });
  const returning = await auth.upsertGoogleUser({
    sub: "google-stable-sub-for-test",
    email: "updated@example.test",
    name: "Updated Name",
    picture: "https://example.test/updated.png",
  });

  assert.equal(returning.id, first.id);
  assert.equal(returning.email, "updated@example.test");
  assert.equal(returning.name, "Updated Name");
});

test("sessions resolve to their server-side user and generations are associated to that user", async () => {
  const user = await auth.upsertGoogleUser({
    sub: "another-google-sub-for-test",
    email: "campaign@example.test",
    name: "Campaign User",
  });
  const token = await auth.issueSession(user.id);
  const request = { headers: { cookie: `adspark_session=${token}` } };

  assert.equal((await auth.getAuthenticatedUser(request)).id, user.id);
  assert.equal(await auth.getAuthenticatedUser({ headers: { cookie: "adspark_session=forged" } }), null);
  await auth.recordGeneration(user.id);
  assert.equal(await auth.getGenerationCountForUser(user.id), 1);
});

test("sign out revokes the server session", async () => {
  const user = await auth.upsertGoogleUser({ sub: "logout-google-sub-for-test" });
  const token = await auth.issueSession(user.id);
  const request = Readable.from([]);
  request.method = "POST";
  request.url = "/api/auth/logout";
  request.headers = {
    origin: "http://localhost:5173",
    cookie: `adspark_session=${token}`,
  };
  const response = {
    headers: {},
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };

  assert.equal((await auth.getAuthenticatedUser(request)).id, user.id);
  assert.equal(await auth.handleAuthRoutes(request, response), true);
  assert.equal(response.status, 200);
  assert.match(response.headers["Set-Cookie"], /Max-Age=0/);
  assert.equal(await auth.getAuthenticatedUser(request), null);
});

test("a forged Google credential is rejected without issuing a session", async () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
  let verificationCalled = false;
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  OAuth2Client.prototype.verifyIdToken = async ({ idToken, audience }) => {
    verificationCalled = idToken === "not-a-valid-google-token" && audience === process.env.GOOGLE_CLIENT_ID;
    throw new Error("Invalid Google token in test.");
  };
  const request = Readable.from([
    Buffer.from(JSON.stringify({ credential: "not-a-valid-google-token" })),
  ]);
  request.method = "POST";
  request.url = "/api/auth/google";
  request.headers = { origin: "http://localhost:5173" };

  let complete;
  const responseComplete = new Promise((resolveResponse) => { complete = resolveResponse; });
  const response = {
    headers: {},
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
      complete(this);
    },
  };

  await auth.handleAuthRoutes(request, response);
  const result = await responseComplete;
  assert.equal(result.status, 401);
  assert.equal(result.headers["Set-Cookie"], undefined);
  assert.equal(verificationCalled, true);
  OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
  if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = previousClientId;
});
