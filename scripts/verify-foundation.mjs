#!/usr/bin/env node
/* Foundation verification: run against the local dev backend (or SUPABASE_URL). */

const BASE = (process.env.SUPABASE_URL ?? "http://localhost:54321").replace(/\/$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "local-anon-key";
const PASSWORD = "Quantum@2026";

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function signIn(email, password = PASSWORD) {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function api(token, method, path, body, extraHeaders = {}) {
  const headers = { apikey: ANON_KEY, ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

// Writes that read the affected row back must ask for a representation,
// exactly like supabase-js does by default.
const RETURN_REPRESENTATION = { Prefer: "return=representation" };

const EMAILS = {
  admin: "ananya.rao@quantumberg.com",
  manager: "vikram.shetty@quantumberg.com",
  priya: "priya.nair@quantumberg.com",
  rahul: "rahul.deshpande@quantumberg.com",
  sneha: "sneha.iyer@quantumberg.com",
  arjun: "arjun.menon@quantumberg.com",
};

const PERSONAL_SNEHA = "c1000000-0000-4000-8000-000000000024";
const PERSONAL_ARJUN = "c1000000-0000-4000-8000-000000000025";

function kolkataToday(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now);
}

function kolkataDate(isoValue) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(isoValue));
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

function remainingHours(task) {
  const estimated = Number(task.estimated_hours ?? 0);
  const progress = Number(task.progress ?? 0);
  return estimated * (1 - progress / 100);
}

const OPEN_STATUSES = ["not_started", "in_progress", "on_hold", "blocked"];

async function main() {
  console.log(`Verifying foundation against ${BASE}\n`);

  const tokens = {};
  for (const [key, email] of Object.entries(EMAILS)) {
    const { status, body } = await signIn(email);
    record(`sign in as ${key} (${email})`, status === 200 && !!body.access_token, `status ${status}`);
    if (status === 200) tokens[key] = body;
  }

  {
    const { status, body } = await signIn(EMAILS.admin, "wrong-password");
    record(
      "wrong password is rejected",
      status === 400 && JSON.stringify(body).includes("Invalid login credentials"),
      `status ${status}`,
    );
  }

  {
    const res = await api(tokens.admin.access_token, "GET", "/auth/v1/user");
    record(
      "GET /auth/v1/user returns the signed-in user",
      res.status === 200 && res.data.email === EMAILS.admin,
      String(res.data?.email ?? res.status),
    );
  }

  {
    const res = await fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body: JSON.stringify({ refresh_token: tokens.admin.refresh_token }),
    });
    const body = await res.json().catch(() => ({}));
    record(
      "refresh token grants a new session",
      res.status === 200 && !!body.access_token,
      `status ${res.status}`,
    );
    if (res.status === 200) tokens.admin.access_token = body.access_token;
  }

  const admin = tokens.admin.access_token;
  const manager = tokens.manager.access_token;
  const priya = tokens.priya.access_token;
  const rahul = tokens.rahul.access_token;
  const sneha = tokens.sneha.access_token;
  const arjun = tokens.arjun.access_token;

  const profilesRes = await api(admin, "GET", "/rest/v1/profiles?select=id,employee_code,role,is_active&order=employee_code");
  record("admin reads all 6 profiles", profilesRes.status === 200 && profilesRes.data.length === 6, `${profilesRes.data?.length} rows`);

  const projectsRes = await api(admin, "GET", "/rest/v1/projects?select=id,code,name,status&order=code");
  record("4 seeded projects", projectsRes.status === 200 && projectsRes.data.length === 4, `${projectsRes.data?.length}`);

  const adminTasksRes = await api(
    admin,
    "GET",
    "/rest/v1/tasks?select=id,status,priority,assignee_id,creator_id,due_date,completed_at,estimated_hours,progress,project_id,is_private&limit=100",
  );
  const adminTasks = adminTasksRes.data ?? [];
  const adminCountHeader = adminTasksRes.headers.get("content-range");
  record(
    "admin task list excludes other people's personal tasks (23 of 25)",
    adminTasks.length === 23,
    `${adminTasks.length} rows, content-range ${adminCountHeader ?? "n/a"}`,
  );

  {
    const snehaPrivate = await api(admin, "GET", `/rest/v1/tasks?id=eq.${PERSONAL_SNEHA}&select=id`);
    record(
      "admin cannot read another user's personal task",
      snehaPrivate.status === 200 && snehaPrivate.data.length === 0,
      `${snehaPrivate.data?.length} rows`,
    );
  }

  {
    const priyaSees = await api(priya, "GET", "/rest/v1/tasks?select=id,assignee_id,creator_id,reviewer_id,is_private,project_id&limit=100");
    const rows = priyaSees.data ?? [];
    const allowed = rows.every(
      (t) => t.assignee_id === tokens.priya.user.id || t.creator_id === tokens.priya.user.id || t.reviewer_id === tokens.priya.user.id,
    );
    record("employee task list only contains assigned/created/reviewed tasks", priyaSees.status === 200 && allowed, `${rows.length} rows`);
  }

  {
    const res = await api(priya, "GET", `/rest/v1/tasks?id=eq.${PERSONAL_SNEHA}&select=id`);
    record("employee cannot read another employee's personal task", res.status === 200 && res.data.length === 0, `${res.data?.length} rows`);
  }

  {
    const res = await api(arjun, "GET", `/rest/v1/tasks?id=eq.${PERSONAL_ARJUN}&select=id`);
    record("employee can read their own personal task", res.status === 200 && res.data.length === 1, `${res.data?.length} rows`);
  }

  {
    const mine = await api(sneha, "GET", "/rest/v1/tasks?select=id,is_private&project_id=is.null&limit=10");
    const rows = mine.data ?? [];
    record(
      "employee sees their own personal tasks (private)",
      rows.length >= 1 && rows.every((t) => t.is_private === true),
      `${rows.length} personal rows`,
    );
  }

  {
    const blocked = adminTasks.filter((t) => t.status === "blocked");
    record("seed has exactly 1 blocked task", blocked.length === 1, `${blocked.length}`);

    const completed = adminTasks.filter((t) => t.status === "completed");
    const today = kolkataToday();
    const late = completed.filter((t) => t.completed_at && kolkataDate(t.completed_at) > t.due_date);
    const onTime = completed.filter((t) => t.completed_at && kolkataDate(t.completed_at) <= t.due_date);
    record(
      "seed has 2 completed tasks: 1 on time, 1 late",
      completed.length === 2 && late.length === 1 && onTime.length === 1,
      `completed ${completed.length}, late ${late.length}, on time ${onTime.length}`,
    );

    const overdue = adminTasks.filter(
      (t) => OPEN_STATUSES.includes(t.status) && t.due_date && t.due_date < today,
    );
    record("seed has exactly 2 overdue open tasks", overdue.length === 2, `${overdue.length} overdue, today ${today}`);

    const personalSneha = await api(sneha, "GET", "/rest/v1/tasks?select=id&project_id=is.null&limit=10");
    const personalArjun = await api(arjun, "GET", "/rest/v1/tasks?select=id&project_id=is.null&limit=10");
    const personalCount = (personalSneha.data?.length ?? 0) + (personalArjun.data?.length ?? 0);
    record("seed has 2 private personal tasks across two users", personalCount === 2, `${personalCount}`);
  }

  {
    const today = kolkataToday();
    const horizon = addDays(today, 7);
    const workload = {};
    for (const [key, token] of Object.entries({ priya, rahul, sneha, arjun })) {
      const userId = tokens[key === "priya" ? "priya" : key].user.id;
      const res = await api(
        token,
        "GET",
        `/rest/v1/tasks?select=estimated_hours,progress,due_date,status&assignee_id=eq.${userId}&status=in.(${OPEN_STATUSES.join(",")})&due_date=lte.${horizon}&limit=100`,
      );
      workload[key] = (res.data ?? []).reduce((sum, t) => sum + remainingHours(t), 0);
    }
    record(
      "overloaded employee (Priya) exceeds 40h remaining due within 7 days",
      workload.priya > 40,
      Object.entries(workload).map(([k, v]) => `${k} ${v.toFixed(1)}h`).join(", "),
    );
    record(
      "other employees are at or below 40h",
      workload.rahul <= 40 && workload.sneha <= 40 && workload.arjun <= 40,
      `rahul ${workload.rahul.toFixed(1)}h, sneha ${workload.sneha.toFixed(1)}h, arjun ${workload.arjun.toFixed(1)}h`,
    );
  }

  {
    const projId = projectsRes.data[0].id;
    const embed = await api(
      admin,
      "GET",
      `/rest/v1/projects?select=id,code,members:project_members(user_id,responsibility),tasks(id,status)&id=eq.${projId}`,
    );
    const row = embed.data?.[0];
    record(
      "embeds work (project with members and tasks)",
      !!row && Array.isArray(row.tasks) && Array.isArray(row.members),
      `tasks ${row?.tasks?.length}, members ${row?.members?.length}`,
    );
  }

  {
    const res = await api(admin, "GET", "/rest/v1/projects?select=code&code=eq.PRJ-001", undefined, {
      Accept: "application/vnd.pgrst.object+json",
    });
    record("single-row Accept returns an object", res.status === 200 && res.data?.code === "PRJ-001", JSON.stringify(res.data));
  }

  {
    const res = await api(admin, "GET", "/rest/v1/tasks?select=id&limit=1", undefined, {
      Prefer: "count=exact",
    });
    const range = res.headers.get("content-range") ?? "";
    record("count=exact returns Content-Range", /^\d+-\d+\/\d+$/.test(range) || /^ \*\/\d+$/.test(range.trim()), range);
  }

  const scratchProjectId = projectsRes.data[0].id;
  const adminId = tokens.admin.user.id;
  const created = await api(admin, "POST", "/rest/v1/tasks", {
    project_id: scratchProjectId,
    title: "VERIFY scratch task",
    assignee_id: adminId,
    creator_id: adminId,
    priority: "medium",
    status: "not_started",
    due_date: addDays(kolkataToday(), 3),
    estimated_hours: 8,
  }, RETURN_REPRESENTATION);
  const createdRow = Array.isArray(created.data) ? created.data[0] : created.data;
  record("create scratch task", created.status === 201 && !!createdRow?.id, `status ${created.status}`);
  const scratchId = createdRow?.id;

  if (scratchId) {
    {
      const res = await api(admin, "PATCH", `/rest/v1/tasks?id=eq.${scratchId}`, { status: "completed" }, RETURN_REPRESENTATION);
      const row = res.data?.[0];
      record(
        "completing a task stamps completed_at and sets progress 100",
        res.status === 200 && !!row?.completed_at && row.progress === 100,
        `completed_at ${row?.completed_at}, progress ${row?.progress}`,
      );
    }
    {
      const res = await api(admin, "PATCH", `/rest/v1/tasks?id=eq.${scratchId}`, { status: "in_progress", progress: 100 }, RETURN_REPRESENTATION);
      const row = res.data?.[0];
      record(
        "reopening caps progress at 90 and clears completed_at",
        res.status === 200 && row.progress === 90 && !row.completed_at,
        `progress ${row?.progress}, completed_at ${row?.completed_at}`,
      );
    }
    {
      const res = await api(admin, "PATCH", `/rest/v1/tasks?id=eq.${scratchId}`, { priority: "critical" }, RETURN_REPRESENTATION);
      record("priority change accepted", res.status === 200 && res.data?.[0]?.priority === "critical");
      const log = await api(admin, "GET", `/rest/v1/activity_log?entity_id=eq.${scratchId}&action=eq.priority_changed`);
      record("priority change writes activity_log", log.data?.length >= 1, `${log.data?.length} rows`);
    }
    {
      const newDue = addDays(kolkataToday(), 5);
      const res = await api(admin, "PATCH", `/rest/v1/tasks?id=eq.${scratchId}`, { due_date: newDue }, RETURN_REPRESENTATION);
      record("due date change accepted", res.status === 200 && res.data?.[0]?.due_date === newDue);
      const log = await api(admin, "GET", `/rest/v1/activity_log?entity_id=eq.${scratchId}&action=eq.due_date_changed`);
      record("due date change writes activity_log with old and new values", log.data?.length >= 1 && !!log.data?.[0]?.old_value && !!log.data?.[0]?.new_value);
    }
    {
      const res = await api(admin, "PATCH", `/rest/v1/tasks?id=eq.${scratchId}`, {
        assignee_id: tokens.priya.user.id,
      }, RETURN_REPRESENTATION);
      record("admin reassignment accepted", res.status === 200 && res.data?.[0]?.assignee_id === tokens.priya.user.id);
      const log = await api(admin, "GET", `/rest/v1/activity_log?entity_id=eq.${scratchId}&action=eq.assignee_changed`);
      record("assignee change writes activity_log", log.data?.length >= 1);
    }

    {
      const res = await api(priya, "PATCH", `/rest/v1/tasks?id=eq.${scratchId}`, {
        assignee_id: tokens.rahul.user.id,
      });
      const msg = JSON.stringify(res.data ?? {});
      record(
        "employee reassignment is rejected by the database",
        res.status >= 400 && msg.includes("reassign"),
        `status ${res.status}: ${msg.slice(0, 120)}`,
      );
    }

    {
      // Use two admin-visible tasks: the scratch task and a seeded project task.
      // (A private personal task must NOT be usable as a dependency target by admins.)
      const visibleTarget = "c1000000-0000-4000-8000-000000000001";
      const depA = await api(admin, "POST", "/rest/v1/task_dependencies", {
        task_id: scratchId,
        depends_on_task_id: visibleTarget,
      });
      const depB = await api(admin, "POST", "/rest/v1/task_dependencies", {
        task_id: visibleTarget,
        depends_on_task_id: scratchId,
      });
      const msg = JSON.stringify(depB.data ?? {});
      record(
        "circular dependency chain is rejected",
        depA.status === 201 && depB.status >= 400 && msg.includes("Circular"),
        `A->B ${depA.status}, B->A ${depB.status}: ${msg.slice(0, 120)}`,
      );
      await api(admin, "DELETE", `/rest/v1/task_dependencies?task_id=eq.${scratchId}`);
    }

    {
      const selfDep = await api(admin, "POST", "/rest/v1/task_dependencies", {
        task_id: scratchId,
        depends_on_task_id: scratchId,
      });
      const msg = JSON.stringify(selfDep.data ?? {});
      record("self dependency is rejected", selfDep.status >= 400 && msg.includes("itself"), `status ${selfDep.status}`);
    }

    {
      const logRows = await api(admin, "GET", `/rest/v1/activity_log?entity_id=eq.${scratchId}&select=id&limit=100`);
      const firstId = logRows.data?.[0]?.id;
      const patched = await api(admin, "PATCH", `/rest/v1/activity_log?id=eq.${firstId}`, { action: "tampered" });
      const patchedRows = Array.isArray(patched.data) ? patched.data.length : patched.status === 204 ? 0 : -1;
      const after = await api(admin, "GET", `/rest/v1/activity_log?id=eq.${firstId}&select=action`);
      record(
        "activity_log cannot be updated through the API",
        patchedRows === 0 && after.data?.[0]?.action !== "tampered",
        `patched ${patchedRows} rows, status ${patched.status}`,
      );
      const deleted = await api(admin, "DELETE", `/rest/v1/activity_log?id=eq.${firstId}`);
      const deletedRows = Array.isArray(deleted.data) ? deleted.data.length : deleted.status === 204 ? 0 : -1;
      const still = await api(admin, "GET", `/rest/v1/activity_log?id=eq.${firstId}&select=id`);
      record(
        "activity_log cannot be deleted through the API",
        deletedRows === 0 && still.data?.length === 1,
        `deleted ${deletedRows} rows, status ${deleted.status}`,
      );
    }

    await api(admin, "DELETE", `/rest/v1/tasks?id=eq.${scratchId}`);
    const gone = await api(admin, "GET", `/rest/v1/tasks?id=eq.${scratchId}&select=id`);
    record("scratch task cleanup", gone.data?.length === 0);
  }

  {
    const res = await api(priya, "POST", "/rest/v1/tasks", {
      project_id: null,
      title: "VERIFY personal task",
      assignee_id: tokens.priya.user.id,
      creator_id: tokens.priya.user.id,
      priority: "low",
      status: "not_started",
      due_date: addDays(kolkataToday(), 2),
    }, RETURN_REPRESENTATION);
    const personalRow = Array.isArray(res.data) ? res.data[0] : res.data;
    record("employee creates a personal task for themselves", res.status === 201 && !!personalRow?.id, `status ${res.status}`);
    if (personalRow?.id) {
      await api(priya, "DELETE", `/rest/v1/tasks?id=eq.${personalRow.id}`);
    }
  }

  {
    const res = await api(priya, "POST", "/rest/v1/tasks", {
      project_id: null,
      title: "VERIFY personal task for someone else",
      assignee_id: tokens.rahul.user.id,
      creator_id: tokens.priya.user.id,
      priority: "low",
      status: "not_started",
    });
    const msg = JSON.stringify(res.data ?? {});
    record(
      "employee cannot create a personal task for someone else",
      res.status >= 400 && msg.includes("yourself"),
      `status ${res.status}`,
    );
  }

  {
    const res = await api(priya, "PATCH", `/rest/v1/projects?id=eq.${projectsRes.data[0].id}`, { name: "HACKED" });
    const rowsTouched = Array.isArray(res.data) ? res.data.length : res.status === 204 ? 0 : -1;
    record("employee cannot edit a project", res.status >= 400 || rowsTouched === 0, `status ${res.status}, rows ${rowsTouched}`);
    const still = await api(admin, "GET", `/rest/v1/projects?id=eq.${projectsRes.data[0].id}&select=name`);
    record("project name unchanged", still.data?.[0]?.name !== "HACKED", still.data?.[0]?.name);
  }

  {
    const res = await api(admin, "PATCH", `/rest/v1/profiles?id=eq.${tokens.sneha.user.id}`, { is_active: false }, RETURN_REPRESENTATION);
    record("admin deactivates an employee", res.status === 200 && res.data?.[0]?.is_active === false);
    const login = await signIn(EMAILS.sneha);
    record(
      "deactivated user cannot sign in",
      login.status >= 400 && JSON.stringify(login.body).toLowerCase().includes("deactivated"),
      `status ${login.status}: ${JSON.stringify(login.body).slice(0, 100)}`,
    );
    const tasksBefore = adminTasks.filter((t) => t.assignee_id === tokens.sneha.user.id).length;
    const tasksAfterRes = await api(admin, "GET", `/rest/v1/tasks?assignee_id=eq.${tokens.sneha.user.id}&select=id&limit=100`);
    record(
      "deactivation keeps every task record",
      tasksAfterRes.data?.length === tasksBefore,
      `${tasksBefore} before, ${tasksAfterRes.data?.length} after`,
    );
    const back = await api(admin, "PATCH", `/rest/v1/profiles?id=eq.${tokens.sneha.user.id}`, { is_active: true }, RETURN_REPRESENTATION);
    record("admin reactivates the employee", back.status === 200 && back.data?.[0]?.is_active === true);
    const relogin = await signIn(EMAILS.sneha);
    record("reactivated user can sign in again", relogin.status === 200, `status ${relogin.status}`);
  }

  {
    const res = await api(sneha, "POST", "/rest/v1/notifications", {
      user_id: tokens.sneha.user.id,
      kind: "task_assigned",
      message: "VERIFY",
      dedupe_key: "verify-1",
    });
    record("clients cannot insert notifications directly (RLS)", res.status >= 400, `status ${res.status}`);
  }

  {
    const res = await api(rahul, "GET", "/rest/v1/tasks?select=id&limit=100");
    record("employee request without filters succeeds", res.status === 200 && Array.isArray(res.data), `${res.data?.length} rows`);
  }

  // ------------------------------------------------------------------
  // Notifications: generated in the database, never by clients.
  // ------------------------------------------------------------------
  let notifyTaskId = null;
  {
    const created = await api(admin, "POST", "/rest/v1/tasks", {
      project_id: scratchProjectId,
      title: "VERIFY notification task",
      assignee_id: tokens.priya.user.id,
      creator_id: adminId,
      reviewer_id: tokens.manager.user.id,
      priority: "medium",
      status: "not_started",
      due_date: addDays(kolkataToday(), 2),
      estimated_hours: 2,
    }, RETURN_REPRESENTATION);
    const row = Array.isArray(created.data) ? created.data[0] : created.data;
    notifyTaskId = row?.id;
    record("create notification scratch task", created.status === 201 && !!notifyTaskId, `status ${created.status}`);

    if (notifyTaskId) {
      const assigned = await api(priya, "GET", `/rest/v1/notifications?task_id=eq.${notifyTaskId}&kind=eq.task_assigned&select=id,message,is_read`);
      record(
        "assignment creates a task_assigned notification for the assignee",
        assigned.status === 200 && assigned.data.length >= 1,
        `${assigned.data?.length} rows`,
      );

      const notifId = assigned.data?.[0]?.id;
      if (notifId) {
        const read = await api(priya, "PATCH", `/rest/v1/notifications?id=eq.${notifId}`, { is_read: true }, RETURN_REPRESENTATION);
        const back = await api(priya, "GET", `/rest/v1/notifications?id=eq.${notifId}&select=is_read`);
        record(
          "assignee can mark their notification read",
          read.status === 200 && back.data?.[0]?.is_read === true,
          `status ${read.status}`,
        );
      }

      await api(admin, "PATCH", `/rest/v1/tasks?id=eq.${notifyTaskId}`, { priority: "critical" });
      const prio = await api(priya, "GET", `/rest/v1/notifications?task_id=eq.${notifyTaskId}&kind=eq.priority_changed&select=id`);
      record(
        "raising priority creates a priority_changed notification",
        prio.status === 200 && prio.data.length >= 1,
        `${prio.data?.length} rows`,
      );

      const comment = await api(admin, "POST", "/rest/v1/comments", {
        task_id: notifyTaskId,
        author_id: adminId,
        body: "Please take a look @Priya",
        mentions: [tokens.priya.user.id],
      });
      record("admin comments on a visible task", comment.status === 201, `status ${comment.status}`);
      const [commentNotif, mentionNotif] = await Promise.all([
        api(priya, "GET", `/rest/v1/notifications?task_id=eq.${notifyTaskId}&kind=eq.comment&select=id`),
        api(priya, "GET", `/rest/v1/notifications?task_id=eq.${notifyTaskId}&kind=eq.mention&select=id`),
      ]);
      record(
        "comment and mention notifications reach the assignee",
        commentNotif.data.length >= 1 && mentionNotif.data.length >= 1,
        `comment ${commentNotif.data?.length}, mention ${mentionNotif.data?.length}`,
      );

      await api(admin, "PATCH", `/rest/v1/tasks?id=eq.${notifyTaskId}`, { status: "completed" });
      const approval = await api(manager, "GET", `/rest/v1/notifications?task_id=eq.${notifyTaskId}&kind=eq.awaiting_approval&select=id`);
      record(
        "completing a reviewed task notifies the reviewer",
        approval.status === 200 && approval.data.length >= 1,
        `${approval.data?.length} rows`,
      );

      // cleanup: each user deletes their own notification rows (own-row policy)
      await api(priya, "DELETE", `/rest/v1/notifications?task_id=eq.${notifyTaskId}`);
      await api(manager, "DELETE", `/rest/v1/notifications?task_id=eq.${notifyTaskId}`);
      const [leftPriya, leftManager] = await Promise.all([
        api(priya, "GET", `/rest/v1/notifications?task_id=eq.${notifyTaskId}&select=id`),
        api(manager, "GET", `/rest/v1/notifications?task_id=eq.${notifyTaskId}&select=id`),
      ]);
      record(
        "notification cleanup (own rows only)",
        (leftPriya.data?.length ?? 0) === 0 && (leftManager.data?.length ?? 0) === 0,
        `priya ${leftPriya.data?.length}, manager ${leftManager.data?.length}`,
      );
      await api(admin, "DELETE", `/rest/v1/comments?task_id=eq.${notifyTaskId}`);
      await api(admin, "DELETE", `/rest/v1/tasks?id=eq.${notifyTaskId}`);
      const gone = await api(admin, "GET", `/rest/v1/tasks?id=eq.${notifyTaskId}&select=id`);
      record("notification task cleanup", gone.data?.length === 0);
    }
  }

  // ------------------------------------------------------------------
  // Recurrence: completing a recurring task spawns the next occurrence.
  // ------------------------------------------------------------------
  {
    const tomorrow = addDays(kolkataToday(), 1);
    const created = await api(admin, "POST", "/rest/v1/tasks", {
      project_id: scratchProjectId,
      title: "VERIFY recurring task",
      assignee_id: adminId,
      creator_id: adminId,
      priority: "low",
      status: "not_started",
      due_date: kolkataToday(),
      estimated_hours: 1,
      recurrence: { kind: "daily", interval: 1 },
    }, RETURN_REPRESENTATION);
    const row = Array.isArray(created.data) ? created.data[0] : created.data;
    record("create recurring daily task", created.status === 201 && !!row?.id, `status ${created.status}`);

    if (row?.id) {
      await api(admin, "PATCH", `/rest/v1/tasks?id=eq.${row.id}`, { status: "completed" });
      const rows = await api(admin, "GET", `/rest/v1/tasks?title=eq.VERIFY recurring task&select=id,status,due_date,recurrence&order=due_date`);
      const next = (rows.data ?? []).find((t) => t.id !== row.id);
      record(
        "completing a recurring task creates the next occurrence",
        rows.data?.length === 2 && next?.status === "not_started" && next?.due_date === tomorrow,
        `${rows.data?.length} rows, next due ${next?.due_date}`,
      );
      record(
        "next occurrence keeps the recurrence rule",
        !!next?.recurrence && next.recurrence.kind === "daily",
        JSON.stringify(next?.recurrence ?? null),
      );
      await api(admin, "DELETE", `/rest/v1/tasks?title=eq.VERIFY recurring task`);
      const gone = await api(admin, "GET", `/rest/v1/tasks?title=eq.VERIFY recurring task&select=id`);
      record("recurring task cleanup", gone.data?.length === 0);
    }
  }

  // ------------------------------------------------------------------
  // Weekly reviews: employees write their own; managers add notes.
  // ------------------------------------------------------------------
  {
    function mondayOf(dateStr) {
      const [y, m, d] = dateStr.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      const diff = (dt.getUTCDay() + 6) % 7;
      dt.setUTCDate(dt.getUTCDate() - diff);
      return dt.toISOString().slice(0, 10);
    }
    const week = mondayOf(kolkataToday());

    await api(priya, "DELETE", `/rest/v1/weekly_reviews?week_start=eq.${week}`);

    const cross = await api(priya, "POST", "/rest/v1/weekly_reviews", {
      user_id: tokens.rahul.user.id,
      week_start: week,
      accomplishments: "not mine",
    });
    const crossMsg = JSON.stringify(cross.data ?? {});
    record(
      "employee cannot write a review for someone else",
      cross.status >= 400,
      `status ${cross.status}: ${crossMsg.slice(0, 100)}`,
    );

    const own = await api(priya, "POST", "/rest/v1/weekly_reviews", {
      user_id: tokens.priya.user.id,
      week_start: week,
      accomplishments: "VERIFY accomplishments",
      next_week_priorities: "VERIFY priorities",
    }, RETURN_REPRESENTATION);
    const ownRow = Array.isArray(own.data) ? own.data[0] : own.data;
    record("employee writes their own weekly review", own.status === 201 && !!ownRow?.id, `status ${own.status}`);

    const notes = await api(manager, "PATCH", `/rest/v1/weekly_reviews?user_id=eq.${tokens.priya.user.id}&week_start=eq.${week}`, {
      manager_notes: "VERIFY manager notes",
    }, RETURN_REPRESENTATION);
    record(
      "manager adds notes to a team member's review",
      notes.status === 200 && (Array.isArray(notes.data) ? notes.data.length : 1) >= 1,
      `status ${notes.status}`,
    );

    const mine = await api(priya, "GET", `/rest/v1/weekly_reviews?week_start=eq.${week}&select=id,user_id`);
    const theirs = await api(rahul, "GET", `/rest/v1/weekly_reviews?week_start=eq.${week}&select=id,user_id`);
    record(
      "review visibility: employee sees only their own row",
      mine.status === 200 && mine.data.length === 1 && (theirs.data?.length ?? 0) === 0,
      `priya ${mine.data?.length}, rahul ${theirs.data?.length}`,
    );

    await api(priya, "DELETE", `/rest/v1/weekly_reviews?week_start=eq.${week}`);
    const after = await api(priya, "GET", `/rest/v1/weekly_reviews?week_start=eq.${week}&select=id`);
    record("review cleanup", after.data?.length === 0, `${after.data?.length} rows`);
  }

  // ------------------------------------------------------------------
  // Comments respect task privacy.
  // ------------------------------------------------------------------
  {
    const snehaComment = await api(sneha, "POST", "/rest/v1/comments", {
      task_id: PERSONAL_SNEHA,
      author_id: tokens.sneha.user.id,
      body: "VERIFY private comment",
      mentions: [],
    }, RETURN_REPRESENTATION);
    record("comment author inserts on their own private task", snehaComment.status === 201, `status ${snehaComment.status}`);

    const snooped = await api(priya, "GET", `/rest/v1/comments?task_id=eq.${PERSONAL_SNEHA}&select=id`);
    record(
      "another employee cannot read comments on a private task",
      snooped.status === 200 && (snooped.data?.length ?? 0) === 0,
      `${snooped.data?.length} rows`,
    );

    const own = await api(sneha, "GET", `/rest/v1/comments?task_id=eq.${PERSONAL_SNEHA}&select=id`);
    record("comment author still sees their comment", own.status === 200 && own.data.length === 1, `${own.data?.length} rows`);
    await api(sneha, "DELETE", `/rest/v1/comments?task_id=eq.${PERSONAL_SNEHA}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${passed} passed, ${failed} failed, ${results.length} checks`);
  if (failed > 0) {
    console.log("\nFailed checks:");
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name} ${r.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("verification crashed:", e);
  process.exitCode = 1;
});
