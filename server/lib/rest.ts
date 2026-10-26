import type { Claims, ForeignKey, TableInfo, Tx } from "./db";

export interface RestCall {
  method: string;
  pathname: string;
  search: URLSearchParams;
  prefer: string[];
  accept: string;
  range: string | undefined;
  body: unknown;
  role: "anon" | "authenticated" | "service_role";
  claims: Claims | null;
}

export interface RestResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export class RestError extends Error {
  constructor(
    readonly status: number,
    readonly payload: Record<string, unknown>,
  ) {
    super(String(payload.message ?? ""));
  }
}

const DEFAULT_MAX_ROWS = 1000;

function err(status: number, code: string, message: string, extra: Record<string, unknown> = {}): RestError {
  return new RestError(status, {
    code,
    message,
    details: extra.details ?? null,
    hint: extra.hint ?? null,
    ...extra,
  });
}

function qident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function qlit(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function rowObjectExpr(table: TableInfo, alias: string): string {
  const prefix = alias ? `${alias}.` : "";
  const parts = table.columnOrder.map((c) => `${qlit(c)}, ${prefix}${qident(c)}`);
  return `jsonb_build_object(${parts.join(", ")})`;
}

const SIMPLE_OPERATORS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "cs",
  "cd",
  "ov",
  "sl",
  "sr",
  "nx",
  "nxs",
  "nxl",
  "nxr",
]);

interface SqlCtx {
  params: unknown[];
  push(value: unknown): string;
}

function makeCtx(): SqlCtx {
  const ctx: SqlCtx = {
    params: [],
    push(value: unknown) {
      ctx.params.push(value === undefined ? null : value);
      return `$${ctx.params.length}`;
    },
  };
  return ctx;
}

function splitTop(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === sep && depth === 0) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

interface ParsedFilterOp {
  op: string;
  value: string;
  negated: boolean;
}

function parseFilterOp(raw: string): ParsedFilterOp {
  const firstDot = raw.indexOf(".");
  if (firstDot > 0) {
    const head = raw.slice(0, firstDot);
    const after = raw.slice(firstDot + 1);
    if (head === "not") {
      const secondDot = after.indexOf(".");
      if (secondDot > 0 && (SIMPLE_OPERATORS.has(after.slice(0, secondDot)) || after.startsWith("not."))) {
        const innerHead = after.slice(0, secondDot);
        if (innerHead === "not") {
          return { op: "neq", value: after.slice(secondDot + 1), negated: false };
        }
        return { op: innerHead, value: after.slice(secondDot + 1), negated: true };
      }
      return { op: "eq", value: after, negated: true };
    }
    if (SIMPLE_OPERATORS.has(head)) return { op: head, value: after, negated: false };
  }
  return { op: "eq", value: raw, negated: false };
}

function buildCondition(colSql: string, raw: string, ctx: SqlCtx): string {
  const { op, value, negated } = parseFilterOp(raw);
  switch (op) {
    case "eq":
      if (value === "null") return `${colSql} is null`;
      return `${colSql}${negated ? " is distinct from " : " = "}${ctx.push(value)}`;
    case "neq":
      if (value === "null") return `${colSql} is not null`;
      return `${negated ? `${colSql} = ${ctx.push(value)}` : `${colSql} <> ${ctx.push(value)}`}`;
    case "gt":
      return `${colSql} > ${ctx.push(value)}`;
    case "gte":
      return `${colSql} >= ${ctx.push(value)}`;
    case "lt":
      return `${colSql} < ${ctx.push(value)}`;
    case "lte":
      return `${colSql} <= ${ctx.push(value)}`;
    case "like":
      return `${colSql} ${negated ? "not like" : "like"} ${ctx.push(value)}`;
    case "ilike":
      return `${colSql} ${negated ? "not ilike" : "ilike"} ${ctx.push(value)}`;
    case "is": {
      if (value === "null") return `${colSql} is ${negated ? "not " : ""}null`;
      if (value === "true" || value === "false") return `${colSql} is ${negated ? "not " : ""}${value}`;
      throw err(400, "PGRST101", `unexpected is operator value: ${value}`);
    }
    case "in": {
      const inner = value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1) : value;
      if (inner === "") return "false";
      const parts = splitTop(inner, ",").filter((p) => p.length > 0);
      const list = parts.map((p) => ctx.push(p));
      return `${colSql} ${negated ? "not in" : "in"} (${list.join(", ")})`;
    }
    case "cs":
      return `${colSql} @> ${ctx.push(value)}`;
    case "cd":
      return `${colSql} <@ ${ctx.push(value)}`;
    case "ov":
      return `${colSql} && ${ctx.push(value)}`;
    case "sl":
      return `${colSql} << ${ctx.push(value)}`;
    case "sr":
      return `${colSql} >> ${ctx.push(value)}`;
    case "nx":
      return `${colSql} &> ${ctx.push(value)}`;
    case "nxs":
      return `${colSql} &<@ ${ctx.push(value)}`;
    case "nxl":
      return `${colSql} <<| ${ctx.push(value)}`;
    case "nxr":
      return `${colSql} |>> ${ctx.push(value)}`;
    default:
      throw err(400, "PGRST101", `unexpected operator in filter: ${raw}`);
  }
}

function splitFilterElement(part: string): { col: string; rest: string } {
  const eq = part.indexOf("=");
  if (eq >= 0) return { col: part.slice(0, eq), rest: part.slice(eq + 1) };
  const dot = part.indexOf(".");
  if (dot < 0) return { col: part, rest: "eq.null" };
  return { col: part.slice(0, dot), rest: part.slice(dot + 1) };
}

function buildGroupCondition(
  table: TableInfo,
  alias: string,
  raw: string,
  connector: "or" | "and",
  ctx: SqlCtx,
): string {
  const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw;
  const parts = splitTop(inner, ",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw err(400, "PGRST101", `empty ${connector} group`);
  const built = parts.map((part) => {
    const { col, rest } = splitFilterElement(part);
    return buildColumnCondition(table, alias, col, rest, ctx);
  });
  return `(${built.join(` ${connector} `)})`;
}

function buildColumnCondition(
  table: TableInfo,
  alias: string,
  col: string,
  raw: string,
  ctx: SqlCtx,
): string {
  if (col === "or" || col === "and") {
    return buildGroupCondition(table, alias, raw, col, ctx);
  }
  if (!table.columns.has(col)) {
    throw err(400, "42703", `column "${table.name}.${col}" does not exist`);
  }
  return buildCondition(`${alias}.${qident(col)}`, raw, ctx);
}

interface SelectColumn {
  src: string;
  out: string;
}

interface SelectEmbed {
  kind: "embed";
  alias: string;
  table: string;
  hint?: string;
  inner: SelectColumn[] | "star";
}

interface SelectPlain {
  kind: "column";
  src: string;
  out: string;
}

type SelectItem = SelectEmbed | SelectPlain | { kind: "star" };

const registry = new Map<string, TableInfo>();

export function registerSchema(tables: TableInfo[]): void {
  registry.clear();
  for (const t of tables) registry.set(t.name, t);
}

function tableInfo(name: string): TableInfo | undefined {
  return registry.get(name);
}

function parseInnerColumns(inner: string, target: TableInfo): SelectColumn[] | "star" {
  const cols: SelectColumn[] = [];
  for (const raw of splitTop(inner, ",")) {
    const part = raw.trim();
    if (part === "") continue;
    if (part === "*") return "star";
    if (part.includes("(")) {
      throw err(400, "PGRST116", "nested embeds are not supported by this dev server");
    }
    const colon = part.indexOf(":");
    let src = part;
    let out = part;
    if (colon >= 0) {
      src = part.slice(0, colon).trim();
      out = part.slice(colon + 1).trim();
    }
    if (!target.columns.has(src)) throw err(400, "42703", `column "${target.name}.${src}" does not exist`);
    cols.push({ src, out });
  }
  return cols.length === 0 ? "star" : cols;
}

function parseSelect(select: string | null, table: TableInfo): SelectItem[] {
  if (!select || select.trim() === "") return [{ kind: "star" }];
  const items: SelectItem[] = [];
  for (const raw of splitTop(select, ",")) {
    const item = raw.trim();
    if (item === "") continue;
    if (item === "*") {
      items.push({ kind: "star" });
      continue;
    }
    const open = item.indexOf("(");
    const hasInner = open >= 0;
    const close = item.lastIndexOf(")");
    const head = hasInner ? item.slice(0, open) : item;
    const innerRaw = hasInner ? item.slice(open + 1, close) : null;

    let alias: string | undefined;
    let target = head;
    const colon = head.indexOf(":");
    if (colon >= 0) {
      const left = head.slice(0, colon).trim();
      const right = head.slice(colon + 1).trim();
      if (table.columns.has(left) && !hasInner && !right.includes("!")) {
        items.push({ kind: "column", src: left, out: right });
        continue;
      }
      alias = left;
      target = right;
    }

    let name = target;
    let hint: string | undefined;
    const bang = target.indexOf("!");
    if (bang >= 0) {
      name = target.slice(0, bang).trim();
      hint = target.slice(bang + 1).trim();
    }

    if (hasInner) {
      if (!tableInfo(name)) {
        throw err(400, "PGRST205", `Could not find a relationship for '${name}'`);
      }
      items.push({
        kind: "embed",
        alias: alias ?? name,
        table: name,
        hint,
        inner: parseInnerColumns(innerRaw ?? "*", tableInfo(name)!),
      });
      continue;
    }
    if (table.columns.has(name)) {
      items.push({ kind: "column", src: name, out: alias ?? name });
      continue;
    }
    if (tableInfo(name)) {
      items.push({ kind: "embed", alias: alias ?? name, table: name, hint, inner: "star" });
      continue;
    }
    throw err(400, "42703", `column "${table.name}.${name}" does not exist`);
  }
  if (items.length === 0) items.push({ kind: "star" });
  return items;
}

interface EmbedPlan extends SelectEmbed {
  info: TableInfo;
  direction: "m2o" | "o2m";
  fk: ForeignKey;
}

function resolveEmbed(source: TableInfo, item: SelectEmbed): EmbedPlan {
  const target = tableInfo(item.table);
  if (!target) {
    throw err(400, "PGRST205", `Could not find a relationship between '${source.name}' and '${item.table}'`);
  }
  const m2o = source.foreignKeys.filter((fk) => fk.dstTable === target.name);
  const o2m = target.foreignKeys.filter((fk) => fk.dstTable === source.name);
  const candidates: Array<{ fk: ForeignKey; direction: "m2o" | "o2m" }> = [];

  if (item.hint && item.hint !== "inner") {
    const hint = item.hint;
    for (const fk of m2o) {
      if (fk.constraint === hint || fk.srcColumn === hint || fk.dstTable === hint) {
        candidates.push({ fk, direction: "m2o" });
      }
    }
    for (const fk of o2m) {
      if (
        fk.constraint === hint ||
        fk.srcColumn === hint ||
        fk.srcTable === hint ||
        `${fk.srcTable}.${fk.srcColumn}` === hint
      ) {
        candidates.push({ fk, direction: "o2m" });
      }
    }
  } else {
    for (const fk of m2o) candidates.push({ fk, direction: "m2o" });
    for (const fk of o2m) candidates.push({ fk, direction: "o2m" });
  }

  if (candidates.length === 0) {
    throw err(400, "PGRST205", `Could not find a relationship between '${source.name}' and '${target.name}'`, {
      details: relationshipList([...m2o, ...o2m]),
    });
  }
  if (candidates.length > 1) {
    throw err(400, "PGRST205", `More than one relationship was found for '${source.name}' and '${target.name}'`, {
      details: relationshipList([...m2o, ...o2m]),
      hint: `Add a hint, for example select=...${item.table}!${candidates[0].fk.constraint}(...)`,
    });
  }
  const picked = candidates[0];
  return { ...item, info: target, direction: picked.direction, fk: picked.fk };
}

function relationshipList(fks: ForeignKey[]): string {
  if (fks.length === 0) return "no foreign keys found between these tables";
  return fks.map((fk) => `${fk.srcTable}.${fk.srcColumn} -> ${fk.dstTable}.${fk.dstColumn}`).join("; ");
}

interface OrderSpec {
  col: string;
  ascending: boolean;
  nulls?: "first" | "last";
}

function parseOrderSpecs(order: string | null, table: TableInfo): OrderSpec[] {
  if (!order) return [];
  const specs: OrderSpec[] = [];
  for (const raw of order.split(",")) {
    const part = raw.trim();
    if (part === "") continue;
    const segments = part.split(".");
    const col = segments[0];
    let ascending = true;
    let nulls: "first" | "last" | undefined;
    for (let i = 1; i < segments.length; i += 1) {
      const s = segments[i];
      if (s === "asc") ascending = true;
      else if (s === "desc") ascending = false;
      else if (s === "nullslast") nulls = "last";
      else if (s === "nullsfirst") nulls = "first";
    }
    if (!table.columns.has(col)) {
      throw err(400, "42703", `column "${table.name}.${col}" does not exist in order clause`);
    }
    specs.push({ col, ascending, nulls });
  }
  return specs;
}

function renderOrder(specs: OrderSpec[], alias: string): string {
  if (specs.length === 0) return "";
  return specs
    .map(
      (s) =>
        `${alias}.${qident(s.col)} ${s.ascending ? "asc" : "desc"}${s.nulls ? ` nulls ${s.nulls}` : ""}`,
    )
    .join(", ");
}

function buildObjectExpr(cols: SelectColumn[], aliasSql: string): string {
  if (cols.length === 0) return "'{}'::jsonb";
  const parts = cols.map((c) => `${qlit(c.out)}, ${aliasSql}.${qident(c.src)}`);
  return `jsonb_build_object(${parts.join(", ")})`;
}

interface RequestParams {
  select: string | null;
  order: string | null;
  limit: string | null;
  offset: string | null;
  columns: string | null;
  onConflict: string | null;
  filters: Array<{ key: string; value: string }>;
}

function collectParams(search: URLSearchParams): RequestParams {
  const out: RequestParams = {
    select: null,
    order: null,
    limit: null,
    offset: null,
    columns: null,
    onConflict: null,
    filters: [],
  };
  for (const [key, value] of search.entries()) {
    if (key === "select") out.select = value;
    else if (key === "order") out.order = value;
    else if (key === "limit") out.limit = value;
    else if (key === "offset") out.offset = value;
    else if (key === "columns") out.columns = value;
    else if (key === "on_conflict") out.onConflict = value;
    else out.filters.push({ key, value });
  }
  return out;
}

interface EmbedExtras {
  conds: Map<string, Array<{ key: string; value: string }>>;
  orders: Map<string, string>;
  limits: Map<string, { limit?: number; offset?: number }>;
}

function splitParams(
  params: RequestParams,
  embeds: Map<string, EmbedPlan>,
  table: TableInfo,
): { mainFilters: Array<{ key: string; value: string }>; extras: EmbedExtras } {
  const extras: EmbedExtras = { conds: new Map(), orders: new Map(), limits: new Map() };
  const main: Array<{ key: string; value: string }> = [];
  for (const f of params.filters) {
    const dot = f.key.indexOf(".");
    if (dot < 0) {
      main.push(f);
      continue;
    }
    const head = f.key.slice(0, dot);
    const rest = f.key.slice(dot + 1);
    if (table.columns.has(head) || head === "or" || head === "and") {
      main.push(f);
      continue;
    }
    // PostgREST "not.column=op.value" -> "column=not.op.value"
    if (head === "not") {
      const innerDot = rest.indexOf(".");
      const innerHead = innerDot < 0 ? rest : rest.slice(0, innerDot);
      if (table.columns.has(innerHead)) {
        main.push({ key: rest, value: `not.${f.value}` });
        continue;
      }
    }
    const plan = embeds.get(head);
    if (!plan) throw err(400, "42703", `column "${head}.${rest}" does not exist`);
    if (rest === "order") extras.orders.set(head, f.value);
    else if (rest === "limit" || rest === "offset") {
      const entry = extras.limits.get(head) ?? {};
      entry[rest] = Number(f.value);
      extras.limits.set(head, entry);
    } else {
      const list = extras.conds.get(head) ?? [];
      list.push({ key: rest, value: f.value });
      extras.conds.set(head, list);
    }
  }
  return { mainFilters: main, extras };
}

function hasMainFilter(params: RequestParams): boolean {
  return params.filters.some((f) => f.key.indexOf(".") < 0);
}

interface Plan {
  selectSql: string;
  whereSql: string;
  orderBySql: string;
  limitSql: string;
  offsetSql: string;
}

function castSelectExpr(table: TableInfo, alias: string, name: string): string {
  const col = table.columns.get(name);
  const ref = `${alias}.${qident(name)}`;
  if (!col) return ref;
  // Match PostgREST wire format: date -> "YYYY-MM-DD", numeric -> JSON number, time -> text.
  if (col.udtName === "date") return `to_char(${ref}, 'YYYY-MM-DD')`;
  if (col.udtName === "numeric")
    return `case when ${ref} is null then null else ${ref}::double precision end`;
  if (col.udtName === "time" || col.udtName === "timetz")
    return `case when ${ref} is null then null else ${ref}::text end`;
  return ref;
}

function buildPlan(
  table: TableInfo,
  params: RequestParams,
  call: RestCall,
  ctx: SqlCtx,
  withSelect: boolean,
): Plan {
  const alias = "t0";
  const parsed = parseSelect(params.select, table);
  const embeds = new Map<string, EmbedPlan>();
  const embedPlans: EmbedPlan[] = [];

  for (const item of parsed) {
    if (item.kind !== "embed") continue;
    const plan = resolveEmbed(table, item);
    if (!embeds.has(plan.alias)) embeds.set(plan.alias, plan);
    if (!embeds.has(plan.table)) embeds.set(plan.table, plan);
    embedPlans.push(plan);
  }
  const { mainFilters, extras } = splitParams(params, embeds, table);

  const selectParts: string[] = [];
  if (withSelect) {
    for (const part of parsed) {
      if (part.kind === "star") {
        for (const name of table.columnOrder) {
          selectParts.push(
            `${castSelectExpr(table, alias, name)} as ${qident(name)}`,
          );
        }
      } else if (part.kind === "column") {
        selectParts.push(
          `${castSelectExpr(table, alias, part.src)} as ${qident(part.out)}`,
        );
      }
    }
  }

  const extraWhere: string[] = [];
  const seen = new Set<string>();
  for (const plan of embedPlans) {
    const planKey = `${plan.alias}:${plan.direction}:${plan.fk.constraint}`;
    if (seen.has(planKey)) continue;
    seen.add(planKey);

    const cols =
      plan.inner === "star" ? plan.info.columnOrder.map((n) => ({ src: n, out: n })) : plan.inner;
    const condList = extras.conds.get(plan.alias) ?? [];
    const needsConds = withSelect || plan.hint === "inner" || plan.direction === "m2o";
    const condSql = needsConds
      ? condList
          .map((c) => buildColumnCondition(plan.info, "e", c.key, c.value, ctx))
          .join(" and ")
      : "";

    if (plan.direction === "m2o") {
      const joinCond = `e.${qident(plan.fk.dstColumn)} = ${alias}.${qident(plan.fk.srcColumn)}`;
      const subWhere = [joinCond, condSql].filter(Boolean).join(" and ");
      if (withSelect) {
        selectParts.push(
          `(select ${buildObjectExpr(cols, "e")} from public.${qident(plan.info.name)} e where ${subWhere}) as ${qident(plan.alias)}`,
        );
      }
      if (plan.hint === "inner" || condSql) {
        extraWhere.push(`exists (select 1 from public.${qident(plan.info.name)} e where ${subWhere})`);
      }
    } else {
      const joinCond = `e.${qident(plan.fk.srcColumn)} = ${alias}.${qident(plan.fk.dstColumn)}`;
      const subWhere = [joinCond, condSql].filter(Boolean).join(" and ");
      if (withSelect) {
        const objExpr = buildObjectExpr(cols, "e");
        const embedOrderSpecs = parseOrderSpecs(extras.orders.get(plan.alias) ?? null, plan.info);
        const defaultOrderSpecs: OrderSpec[] = plan.info.primaryKey.map((c) => ({
          col: c,
          ascending: true,
        }));
        const orderSpecs = embedOrderSpecs.length > 0 ? embedOrderSpecs : defaultOrderSpecs;
        const ordSelect = orderSpecs
          .map((s, i) => `, e.${qident(s.col)} as ${qident(`__ord${i + 1}`)}`)
          .join("");
        const innerOrder = orderSpecs.length ? ` order by ${renderOrder(orderSpecs, "e")}` : "";
        const aggOrder =
          orderSpecs.length > 0
            ? ` order by ${orderSpecs.map((s, i) => `${qident(`__ord${i + 1}`)} ${s.ascending ? "asc" : "desc"}${s.nulls ? ` nulls ${s.nulls}` : ""}`).join(", ")}`
            : "";
        const limitSql = extras.limits.get(plan.alias)?.limit !== undefined
          ? ` limit ${Number(extras.limits.get(plan.alias)!.limit)}`
          : "";
        const offsetSql = extras.limits.get(plan.alias)?.offset !== undefined
          ? ` offset ${Number(extras.limits.get(plan.alias)!.offset)}`
          : "";
        selectParts.push(
          `(select coalesce(jsonb_agg(sub.__row${aggOrder}), '[]'::jsonb) from (select ${objExpr} as __row${ordSelect} from public.${qident(plan.info.name)} e where ${subWhere}${innerOrder}${limitSql}${offsetSql}) sub) as ${qident(plan.alias)}`,
        );
      }
      if (plan.hint === "inner") {
        extraWhere.push(`exists (select 1 from public.${qident(plan.info.name)} e where ${subWhere})`);
      }
    }
  }

  const whereParts: string[] = [];
  const mainConds = mainFilters.map((f) => buildColumnCondition(table, alias, f.key, f.value, ctx));
  if (mainConds.length > 0) whereParts.push(mainConds.join(" and "));
  if (extraWhere.length > 0) whereParts.push(extraWhere.join(" and "));
  const whereSql = whereParts.length > 0 ? ` where ${whereParts.join(" and ")}` : "";

  const orderBySql = (() => {
    const specs = parseOrderSpecs(params.order, table);
    return specs.length ? ` order by ${renderOrder(specs, alias)}` : "";
  })();

  let limitSql = "";
  let offsetSql = "";
  const range = call.range;
  if (range) {
    const m = /^(?:items=)?(\d+)-(\d+)$/.exec(range.trim());
    if (m) {
      const start = Number(m[1]);
      const end = Number(m[2]);
      offsetSql = ` offset ${start}`;
      limitSql = ` limit ${Math.max(end - start + 1, 0)}`;
    }
  }
  if (params.offset) offsetSql = ` offset ${Number(params.offset)}`;
  if (params.limit) limitSql = ` limit ${Number(params.limit)}`;
  if (!limitSql) limitSql = ` limit ${DEFAULT_MAX_ROWS}`;

  const selectSql = selectParts.length > 0 ? selectParts.join(", ") : `${alias}.*`;
  return { selectSql, whereSql, orderBySql, limitSql, offsetSql };
}

function wantsSingle(call: RestCall): boolean {
  return call.accept.includes("application/vnd.pgrst.object");
}

function wantsRepresentation(call: RestCall): boolean {
  return call.prefer.some((p) => p.trim() === "return=representation");
}

function countMode(call: RestCall): string | null {
  for (const p of call.prefer) {
    const m = /count=(exact|planned|estimated)/.exec(p);
    if (m) return m[1];
  }
  return null;
}

function singleError(rowCount: number): RestError {
  return new RestError(406, {
    code: "PGRST116",
    message: "JSON object requested, multiple (or no) rows returned",
    details: `Results contain ${rowCount} rows, application/vnd.pgrst.object+json requires 1 row`,
    hint: null,
  });
}

async function handleSelect(
  tx: Tx,
  table: TableInfo,
  params: RequestParams,
  call: RestCall,
): Promise<RestResult> {
  const ctx = makeCtx();
  const plan = buildPlan(table, params, call, ctx, true);
  const sql = `select ${plan.selectSql} from public.${qident(table.name)} t0${plan.whereSql}${plan.orderBySql}${plan.limitSql}${plan.offsetSql}`;
  const result = await tx.query<Record<string, unknown>>(sql, ctx.params);
  const rows = result.rows;

  const headers: Record<string, string> = {};
  if (countMode(call)) {
    const countCtx = makeCtx();
    const countPlan = buildPlan(table, params, call, countCtx, false);
    const countSql = `select count(*)::bigint as c from public.${qident(table.name)} t0${countPlan.whereSql}`;
    const countRes = await tx.query<{ c: string | number }>(countSql, countCtx.params);
    const total = Number(countRes.rows[0]?.c ?? 0);
    const offsetMatch = /offset (\d+)/.exec(plan.offsetSql);
    const offset = Number(offsetMatch?.[1] ?? 0);
    headers["Content-Range"] =
      rows.length > 0
        ? `${offset}-${offset + rows.length - 1}/${total}`
        : `*/${total}`;
  }

  if (wantsSingle(call)) {
    if (rows.length !== 1) throw singleError(rows.length);
    return { status: 200, body: rows[0], headers };
  }
  return { status: 200, body: rows, headers };
}

function normaliseBody(call: RestCall): Record<string, unknown> | Array<Record<string, unknown>> {
  const body = call.body;
  if (body === null || body === undefined || body === "") return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      throw err(400, "PGRST102", "Invalid JSON in request body");
    }
  }
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  if (typeof body === "object") return body as Record<string, unknown>;
  throw err(400, "PGRST102", "JSON object or array expected");
}

function validateColumns(table: TableInfo, keys: string[]): void {
  for (const key of keys) {
    if (!table.columns.has(key)) {
      throw err(400, "42703", `column "${key}" of relation "${table.name}" does not exist`);
    }
  }
}

function parseColumnsParam(raw: string | null): string[] | null {
  if (!raw) return null;
  return raw
    .split(",")
    .map((c) => c.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

async function handleInsert(
  tx: Tx,
  table: TableInfo,
  params: RequestParams,
  call: RestCall,
): Promise<RestResult> {
  const body = normaliseBody(call);
  const rowsInput = Array.isArray(body) ? body : [body];
  if (rowsInput.length === 0) {
    return { status: 201, body: wantsRepresentation(call) ? [] : undefined };
  }
  const explicitCols = parseColumnsParam(params.columns);
  let keyUnion = explicitCols ?? [...new Set(rowsInput.flatMap((r) => Object.keys(r)))];
  if (keyUnion.length === 0) keyUnion = [...table.columnOrder];
  validateColumns(table, keyUnion);

  const ctx = makeCtx();
  const valuesSql = rowsInput
    .map((row) => {
      const cells = keyUnion.map((key) => {
        const value = row[key];
        if (value === undefined) return "default";
        return ctx.push(value);
      });
      return `(${cells.join(", ")})`;
    })
    .join(", ");

  const colList = keyUnion.map((c) => qident(c)).join(", ");
  let conflictSql = "";
  if (params.onConflict) {
    const targets = params.onConflict
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    validateColumns(table, targets);
    const merge = call.prefer.some((p) => p.trim() === "resolution=merge-duplicates");
    const targetSql = targets.map((c) => qident(c)).join(", ");
    if (merge) {
      const setCols = keyUnion.filter((c) => !targets.includes(c));
      conflictSql =
        setCols.length > 0
          ? ` on conflict (${targetSql}) do update set ${setCols
              .map((c) => `${qident(c)} = excluded.${qident(c)}`)
              .join(", ")}`
          : ` on conflict (${targetSql}) do nothing`;
    } else {
      conflictSql = ` on conflict (${targetSql}) do nothing`;
    }
  }

  const representation = wantsRepresentation(call);
  let sql = `insert into public.${qident(table.name)} (${colList}) values ${valuesSql}${conflictSql}`;
  if (representation) {
    sql += ` returning ${rowObjectExpr(table, "")} as __row`;
  }
  const result = await tx.query<{ __row?: unknown }>(sql, ctx.params);

  if (representation) {
    const rowsOut = result.rows.map((r) => r.__row);
    if (wantsSingle(call)) {
      if (rowsOut.length !== 1) throw singleError(rowsOut.length);
      return { status: 201, body: rowsOut[0] };
    }
    return { status: 201, body: rowsOut };
  }
  return { status: 201, headers: { "Preference-Applied": "return=minimal" } };
}

async function handleUpdate(
  tx: Tx,
  table: TableInfo,
  params: RequestParams,
  call: RestCall,
): Promise<RestResult> {
  const body = normaliseBody(call);
  if (Array.isArray(body)) throw err(400, "PGRST102", "PATCH body must be a single object");
  const keys = Object.keys(body);
  if (keys.length === 0) throw err(400, "PGRST102", "PATCH body must include at least one column");
  if (!hasMainFilter(params)) {
    throw err(400, "PGRST102", "No filter specified on PATCH, pass .eq() or another filter");
  }
  validateColumns(table, keys);

  const ctx = makeCtx();
  const sets = keys.map((k) => `${qident(k)} = ${ctx.push((body as Record<string, unknown>)[k])}`);
  const whereSql = buildPlan(table, params, call, ctx, false).whereSql;
  const representation = wantsRepresentation(call);
  let sql = `update public.${qident(table.name)} t0 set ${sets.join(", ")}${whereSql}`;
  if (representation) {
    sql += ` returning ${rowObjectExpr(table, "t0")} as __row`;
  } else {
    sql += " returning t0.ctid";
  }
  const result = await tx.query<{ __row?: unknown; ctid?: unknown }>(sql, ctx.params);

  if (representation) {
    const rowsOut = result.rows.map((r) => r.__row);
    if (wantsSingle(call)) {
      if (rowsOut.length !== 1) throw singleError(rowsOut.length);
      return { status: 200, body: rowsOut[0] };
    }
    return { status: 200, body: rowsOut };
  }
  return { status: 204 };
}

async function handleDelete(
  tx: Tx,
  table: TableInfo,
  params: RequestParams,
  call: RestCall,
): Promise<RestResult> {
  if (!hasMainFilter(params)) {
    throw err(400, "PGRST102", "No filter specified on DELETE, pass .eq() or another filter");
  }
  const ctx = makeCtx();
  const whereSql = buildPlan(table, params, call, ctx, false).whereSql;
  const representation = wantsRepresentation(call);
  let sql = `delete from public.${qident(table.name)} t0${whereSql}`;
  if (representation) {
    sql += ` returning ${rowObjectExpr(table, "t0")} as __row`;
  } else {
    sql += " returning t0.ctid";
  }
  const result = await tx.query<{ __row?: unknown }>(sql, ctx.params);
  if (representation) {
    return { status: 200, body: result.rows.map((r) => r.__row) };
  }
  return { status: 204 };
}

interface RpcMeta {
  name: string;
  argNames: string[];
  returnsSet: boolean;
}

async function handleRpc(tx: Tx, call: RestCall, fnName: string): Promise<RestResult> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fnName)) {
    throw err(400, "PGRST102", `invalid function name: ${fnName}`);
  }
  const meta = await tx.query<RpcMeta>(
    `select p.proname as name,
            coalesce(p.proargnames, '{}') as "argNames",
            p.proretset as "returnsSet"
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1 and p.prokind = 'f'
      limit 1`,
    [fnName],
  );
  const fn = meta.rows[0];
  if (!fn) {
    throw err(404, "PGRST202", `function public.${fnName} does not exist`, {
      hint: "Check the function name",
    });
  }
  const body = normaliseBody(call);
  const input = Array.isArray(body) ? {} : (body as Record<string, unknown>);
  const ctx = makeCtx();
  const argNames = (fn.argNames ?? []) as string[];
  const unknownKeys = Object.keys(input).filter((k) => argNames.length > 0 && !argNames.includes(k));
  if (unknownKeys.length > 0) {
    throw err(400, "PGRST204", `function public.${fnName} does not have parameter ${unknownKeys[0]}`);
  }
  const named = argNames.map((name) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw err(400, "PGRST102", "invalid argument name in function signature");
    }
    const value = input[name];
    if (value === undefined) return `${qident(name)} := null`;
    return `${qident(name)} := ${ctx.push(value)}`;
  });

  const callSql = fn.returnsSet
    ? `select * from public.${qident(fnName)}(${named.join(", ")})`
    : `select public.${qident(fnName)}(${named.join(", ")}) as __v`;
  const result = await tx.query<Record<string, unknown>>(callSql, ctx.params);

  if (fn.returnsSet) {
    if (wantsSingle(call)) {
      if (result.rows.length !== 1) throw singleError(result.rows.length);
      return { status: 200, body: result.rows[0] };
    }
    return { status: 200, body: result.rows };
  }
  const row = result.rows[0];
  const value = row ? row.__v : null;
  return { status: 200, body: value === undefined ? null : value };
}

export function mapDatabaseError(errObj: unknown, call: RestCall): RestResult | null {
  const e = errObj as { code?: string; message?: string; detail?: string; hint?: string } | null;
  if (!e || typeof e.code !== "string") return null;
  let status = 400;
  if (e.code === "42501") status = call.claims ? 403 : 401;
  else if (e.code === "23505" || e.code === "23503") status = 409;
  else if (e.code === "42P01" || e.code === "42704" || e.code === "42883") status = 404;
  return {
    status,
    body: {
      code: e.code,
      message: e.message ?? "database error",
      details: e.detail ?? null,
      hint: e.hint ?? null,
    },
  };
}

export async function handleRest(tx: Tx, call: RestCall): Promise<RestResult> {
  const path = call.pathname.replace(/^\/rest\/v1/, "");
  const segs = path.split("/").filter(Boolean);
  if (segs[0] === "rpc") return handleRpc(tx, call, segs[1] ?? "");
  if (segs.length === 0) throw err(404, "42P01", "missing table name in request path");
  const tableRef = segs[0];
  let tableName = tableRef;
  if (tableRef.includes(".")) {
    const [schemaName, name] = tableRef.split(".");
    if (schemaName !== "public") throw err(404, "42P01", `schema "${schemaName}" is not exposed`);
    tableName = name;
  }
  const table = registry.get(tableName);
  if (!table) throw err(404, "42P01", `relation "public.${tableName}" does not exist`);

  const params = collectParams(call.search);
  switch (call.method.toUpperCase()) {
    case "GET":
      return handleSelect(tx, table, params, call);
    case "HEAD":
      return handleSelect(tx, table, params, call);
    case "POST":
      return handleInsert(tx, table, params, call);
    case "PATCH":
      return handleUpdate(tx, table, params, call);
    case "DELETE":
      return handleDelete(tx, table, params, call);
    default:
      throw err(405, "PGRST105", `method ${call.method} is not allowed`);
  }
}
