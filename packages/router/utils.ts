import type { Location, Path, To } from "./history";
import { parsePath } from "./history";
import { DataResult, DataRouteMatch, Navigation } from "./router";

export type LoaderFormMethod = "get";
export type ActionFormMethod = "post" | "put" | "patch" | "delete";
export type FormMethod = LoaderFormMethod | ActionFormMethod;
export type FormEncType = "application/x-www-form-urlencoded";

/**
 * Internal interface to pass around, not intended for external consumption
 */
export interface Submission {
  formMethod: FormMethod;
  formAction: string;
  formEncType: FormEncType;
  formData: FormData;
}

export interface ActionSubmission extends Submission {
  formMethod: ActionFormMethod;
}

/**
 * Arguments passed to route loader functions
 */
export interface LoaderFunctionArgs {
  request: Request;
  params: Params;
  signal: AbortSignal;
}

/**
 * Arguments passed to route action functions
 */
export interface ActionFunctionArgs {
  request: Request;
  params: Params;
  signal: AbortSignal;
}

export interface ShouldRevalidateFunctionArgs {
  currentUrl: URL;
  currentParams: DataRouteMatch["params"];
  nextUrl: URL;
  nextParams: DataRouteMatch["params"];
  navigation: Navigation;
  actionResult: DataResult | null;
  defaultShouldRevalidate: boolean;
}

/**
 * A route object represents a logical route, with (optionally) its child
 * routes organized in a tree-like structure.
 */
export interface RouteObject {
  caseSensitive?: boolean;
  children?: RouteObject[];
  element?: React.ReactNode;
  index?: boolean;
  path?: string;
  id?: string;
  loader?: (obj: LoaderFunctionArgs) => any | Promise<any>;
  action?: (obj: ActionFunctionArgs) => any | Promise<any>;
  errorElement?: React.ReactNode;
  shouldRevalidate?: (obj: ShouldRevalidateFunctionArgs) => boolean;
  handle?: any;
}

/**
 * A data route object, which is just a RouteObject with a required unique ID
 */
export interface DataRouteObject extends RouteObject {
  children?: DataRouteObject[];
  id: string;
}

type ParamParseFailed = { failed: true };

type ParamParseSegment<Segment extends string> =
  // Check here if there exists a forward slash in the string.
  Segment extends `${infer LeftSegment}/${infer RightSegment}`
    ? // If there is a forward slash, then attempt to parse each side of the
      // forward slash.
      ParamParseSegment<LeftSegment> extends infer LeftResult
      ? ParamParseSegment<RightSegment> extends infer RightResult
        ? LeftResult extends string
          ? // If the left side is successfully parsed as a param, then check if
            // the right side can be successfully parsed as well. If both sides
            // can be parsed, then the result is a union of the two sides
            // (read: "foo" | "bar").
            RightResult extends string
            ? LeftResult | RightResult
            : LeftResult
          : // If the left side is not successfully parsed as a param, then check
          // if only the right side can be successfully parse as a param. If it
          // can, then the result is just right, else it's a failure.
          RightResult extends string
          ? RightResult
          : ParamParseFailed
        : ParamParseFailed
      : // If the left side didn't parse into a param, then just check the right
      // side.
      ParamParseSegment<RightSegment> extends infer RightResult
      ? RightResult extends string
        ? RightResult
        : ParamParseFailed
      : ParamParseFailed
    : // If there's no forward slash, then check if this segment starts with a
    // colon. If it does, then this is a dynamic segment, so the result is
    // just the remainder of the string. Otherwise, it's a failure.
    Segment extends `:${infer Remaining}`
    ? Remaining
    : ParamParseFailed;

// Attempt to parse the given string segment. If it fails, then just return the
// plain string type as a default fallback. Otherwise return the union of the
// parsed string literals that were referenced as dynamic segments in the route.
export type ParamParseKey<Segment extends string> =
  ParamParseSegment<Segment> extends string
    ? ParamParseSegment<Segment>
    : string;

/**
 * The parameters that were parsed from the URL path.
 */
export type Params<Key extends string = string> = {
  readonly [key in Key]: string | undefined;
};

/**
 * A RouteMatch contains info about how a route matched a URL.
 */
export interface RouteMatch<
  ParamKey extends string = string,
  RouteObjectType extends RouteObject = RouteObject
> {
  /**
   * The names and values of dynamic parameters in the URL.
   */
  params: Params<ParamKey>;
  /**
   * The portion of the URL pathname that was matched.
   */
  pathname: string;
  /**
   * The portion of the URL pathname that was matched before child routes.
   */
  pathnameBase: string;
  /**
   * The route object that was used to match.
   */
  route: RouteObjectType;
}

/**
 * Matches the given routes to a location and returns the match data.
 *
 * @see https://reactrouter.com/docs/en/v6/api#matchroutes
 */
export function matchRoutes<RouteObjectType extends RouteObject = RouteObject>(
  routes: RouteObjectType[],
  locationArg: Partial<Location> | string,
  basename = "/"
): RouteMatch<string, RouteObjectType>[] | null {
  let location =
    typeof locationArg === "string" ? parsePath(locationArg) : locationArg;

  let pathname = stripBasename(location.pathname || "/", basename);

  if (pathname == null) {
    return null;
  }

  let branches = flattenRoutes(routes);
  rankRouteBranches(branches);

  let matches = null;
  for (let i = 0; matches == null && i < branches.length; ++i) {
    matches = matchRouteBranch<string, RouteObjectType>(branches[i], pathname);
  }

  return matches;
}

interface RouteMeta<RouteObjectType extends RouteObject = RouteObject> {
  relativePath: string;
  caseSensitive: boolean;
  childrenIndex: number;
  route: RouteObjectType;
}

interface RouteBranch<RouteObjectType extends RouteObject = RouteObject> {
  path: string;
  score: number;
  routesMeta: RouteMeta<RouteObjectType>[];
}

function flattenRoutes<RouteObjectType extends RouteObject = RouteObject>(
  routes: RouteObjectType[],
  branches: RouteBranch<RouteObjectType>[] = [],
  parentsMeta: RouteMeta<RouteObjectType>[] = [],
  parentPath = ""
): RouteBranch<RouteObjectType>[] {
  routes.forEach((route, index) => {
    let meta: RouteMeta<RouteObjectType> = {
      relativePath: route.path || "",
      caseSensitive: route.caseSensitive === true,
      childrenIndex: index,
      route,
    };

    if (meta.relativePath.startsWith("/")) {
      invariant(
        meta.relativePath.startsWith(parentPath),
        `Absolute route path "${meta.relativePath}" nested under path ` +
          `"${parentPath}" is not valid. An absolute child route path ` +
          `must start with the combined path of all its parent routes.`
      );

      meta.relativePath = meta.relativePath.slice(parentPath.length);
    }

    let path = joinPaths([parentPath, meta.relativePath]);
    let routesMeta = parentsMeta.concat(meta);

    // Add the children before adding this route to the array so we traverse the
    // route tree depth-first and child routes appear before their parents in
    // the "flattened" version.
    if (route.children && route.children.length > 0) {
      invariant(
        route.index !== true,
        `Index routes must not have child routes. Please remove ` +
          `all child routes from route path "${path}".`
      );

      flattenRoutes(route.children, branches, routesMeta, path);
    }

    // Routes without a path shouldn't ever match by themselves unless they are
    // index routes, so don't add them to the list of possible branches.
    if (route.path == null && !route.index) {
      return;
    }

    branches.push({ path, score: computeScore(path, route.index), routesMeta });
  });

  return branches;
}

function rankRouteBranches(branches: RouteBranch[]): void {
  branches.sort((a, b) =>
    a.score !== b.score
      ? b.score - a.score // Higher score first
      : compareIndexes(
          a.routesMeta.map((meta) => meta.childrenIndex),
          b.routesMeta.map((meta) => meta.childrenIndex)
        )
  );
}

const paramRe = /^:\w+$/;
const dynamicSegmentValue = 3;
const indexRouteValue = 2;
const emptySegmentValue = 1;
const staticSegmentValue = 10;
const splatPenalty = -2;
const isSplat = (s: string) => s === "*";

function computeScore(path: string, index: boolean | undefined): number {
  let segments = path.split("/");
  let initialScore = segments.length;
  if (segments.some(isSplat)) {
    initialScore += splatPenalty;
  }

  if (index) {
    initialScore += indexRouteValue;
  }

  return segments
    .filter((s) => !isSplat(s))
    .reduce(
      (score, segment) =>
        score +
        (paramRe.test(segment)
          ? dynamicSegmentValue
          : segment === ""
          ? emptySegmentValue
          : staticSegmentValue),
      initialScore
    );
}

function compareIndexes(a: number[], b: number[]): number {
  let siblings =
    a.length === b.length && a.slice(0, -1).every((n, i) => n === b[i]);

  return siblings
    ? // If two routes are siblings, we should try to match the earlier sibling
      // first. This allows people to have fine-grained control over the matching
      // behavior by simply putting routes with identical paths in the order they
      // want them tried.
      a[a.length - 1] - b[b.length - 1]
    : // Otherwise, it doesn't really make sense to rank non-siblings by index,
      // so they sort equally.
      0;
}

function matchRouteBranch<
  ParamKey extends string = string,
  RouteObjectType extends RouteObject = RouteObject
>(
  branch: RouteBranch<RouteObjectType>,
  pathname: string
): RouteMatch<ParamKey, RouteObjectType>[] | null {
  let { routesMeta } = branch;

  let matchedParams = {};
  let matchedPathname = "/";
  let matches: RouteMatch<ParamKey, RouteObjectType>[] = [];
  for (let i = 0; i < routesMeta.length; ++i) {
    let meta = routesMeta[i];
    let end = i === routesMeta.length - 1;
    let remainingPathname =
      matchedPathname === "/"
        ? pathname
        : pathname.slice(matchedPathname.length) || "/";
    let match = matchPath(
      { path: meta.relativePath, caseSensitive: meta.caseSensitive, end },
      remainingPathname
    );

    if (!match) return null;

    Object.assign(matchedParams, match.params);

    let route = meta.route;

    matches.push({
      // TODO: Can this as be avoided?
      params: matchedParams as Params<ParamKey>,
      pathname: joinPaths([matchedPathname, match.pathname]),
      pathnameBase: normalizePathname(
        joinPaths([matchedPathname, match.pathnameBase])
      ),
      route,
    });

    if (match.pathnameBase !== "/") {
      matchedPathname = joinPaths([matchedPathname, match.pathnameBase]);
    }
  }

  return matches;
}

/**
 * Returns a path with params interpolated.
 *
 * @see https://reactrouter.com/docs/en/v6/api#generatepath
 */
export function generatePath(path: string, params: Params = {}): string {
  return path
    .replace(/:(\w+)/g, (_, key) => {
      invariant(params[key] != null, `Missing ":${key}" param`);
      return params[key]!;
    })
    .replace(/\/*\*$/, (_) =>
      params["*"] == null ? "" : params["*"].replace(/^\/*/, "/")
    );
}

/**
 * A PathPattern is used to match on some portion of a URL pathname.
 */
export interface PathPattern<Path extends string = string> {
  /**
   * A string to match against a URL pathname. May contain `:id`-style segments
   * to indicate placeholders for dynamic parameters. May also end with `/*` to
   * indicate matching the rest of the URL pathname.
   */
  path: Path;
  /**
   * Should be `true` if the static portions of the `path` should be matched in
   * the same case.
   */
  caseSensitive?: boolean;
  /**
   * Should be `true` if this pattern should match the entire URL pathname.
   */
  end?: boolean;
}

/**
 * A PathMatch contains info about how a PathPattern matched on a URL pathname.
 */
export interface PathMatch<ParamKey extends string = string> {
  /**
   * The names and values of dynamic parameters in the URL.
   */
  params: Params<ParamKey>;
  /**
   * The portion of the URL pathname that was matched.
   */
  pathname: string;
  /**
   * The portion of the URL pathname that was matched before child routes.
   */
  pathnameBase: string;
  /**
   * The pattern that was used to match.
   */
  pattern: PathPattern;
}

type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

/**
 * Performs pattern matching on a URL pathname and returns information about
 * the match.
 *
 * @see https://reactrouter.com/docs/en/v6/api#matchpath
 */
export function matchPath<
  ParamKey extends ParamParseKey<Path>,
  Path extends string
>(
  pattern: PathPattern<Path> | Path,
  pathname: string
): PathMatch<ParamKey> | null {
  if (typeof pattern === "string") {
    pattern = { path: pattern, caseSensitive: false, end: true };
  }

  let [matcher, paramNames] = compilePath(
    pattern.path,
    pattern.caseSensitive,
    pattern.end
  );

  let match = pathname.match(matcher);
  if (!match) return null;

  let matchedPathname = match[0];
  let pathnameBase = matchedPathname.replace(/(.)\/+$/, "$1");
  let captureGroups = match.slice(1);
  let params: Params = paramNames.reduce<Mutable<Params>>(
    (memo, paramName, index) => {
      // We need to compute the pathnameBase here using the raw splat value
      // instead of using params["*"] later because it will be decoded then
      if (paramName === "*") {
        let splatValue = captureGroups[index] || "";
        pathnameBase = matchedPathname
          .slice(0, matchedPathname.length - splatValue.length)
          .replace(/(.)\/+$/, "$1");
      }

      memo[paramName] = safelyDecodeURIComponent(
        captureGroups[index] || "",
        paramName
      );
      return memo;
    },
    {}
  );

  return {
    params,
    pathname: matchedPathname,
    pathnameBase,
    pattern,
  };
}

function compilePath(
  path: string,
  caseSensitive = false,
  end = true
): [RegExp, string[]] {
  warning(
    path === "*" || !path.endsWith("*") || path.endsWith("/*"),
    `Route path "${path}" will be treated as if it were ` +
      `"${path.replace(/\*$/, "/*")}" because the \`*\` character must ` +
      `always follow a \`/\` in the pattern. To get rid of this warning, ` +
      `please change the route path to "${path.replace(/\*$/, "/*")}".`
  );

  let paramNames: string[] = [];
  let regexpSource =
    "^" +
    path
      .replace(/\/*\*?$/, "") // Ignore trailing / and /*, we'll handle it below
      .replace(/^\/*/, "/") // Make sure it has a leading /
      .replace(/[\\.*+^$?{}|()[\]]/g, "\\$&") // Escape special regex chars
      .replace(/:(\w+)/g, (_: string, paramName: string) => {
        paramNames.push(paramName);
        return "([^\\/]+)";
      });

  if (path.endsWith("*")) {
    paramNames.push("*");
    regexpSource +=
      path === "*" || path === "/*"
        ? "(.*)$" // Already matched the initial /, just match the rest
        : "(?:\\/(.+)|\\/*)$"; // Don't include the / in params["*"]
  } else {
    regexpSource += end
      ? "\\/*$" // When matching to the end, ignore trailing slashes
      : // Otherwise, match a word boundary or a proceeding /. The word boundary restricts
        // parent routes to matching only their own words and nothing more, e.g. parent
        // route "/home" should not match "/home2".
        // Additionally, allow paths starting with `.`, `-`, `~`, and url-encoded entities,
        // but do not consume the character in the matched path so they can match against
        // nested paths.
        "(?:(?=[.~-]|%[0-9A-F]{2})|\\b|\\/|$)";
  }

  let matcher = new RegExp(regexpSource, caseSensitive ? undefined : "i");

  return [matcher, paramNames];
}

function safelyDecodeURIComponent(value: string, paramName: string) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    warning(
      false,
      `The value for the URL param "${paramName}" will not be decoded because` +
        ` the string "${value}" is a malformed URL segment. This is probably` +
        ` due to a bad percent encoding (${error}).`
    );

    return value;
  }
}

export function stripBasename(
  pathname: string,
  basename: string
): string | null {
  if (basename === "/") return pathname;

  if (!pathname.toLowerCase().startsWith(basename.toLowerCase())) {
    return null;
  }

  let nextChar = pathname.charAt(basename.length);
  if (nextChar && nextChar !== "/") {
    // pathname does not start with basename/
    return null;
  }

  return pathname.slice(basename.length) || "/";
}

export function invariant(value: boolean, message?: string): asserts value;
export function invariant<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T;
export function invariant(value: any, message?: string) {
  if (value === false || value === null || typeof value === "undefined") {
    throw new Error(message);
  }
}

export function warning(cond: any, message: string): void {
  if (!cond) {
    // eslint-disable-next-line no-console
    if (typeof console !== "undefined") console.warn(message);

    try {
      // Welcome to debugging React Router!
      //
      // This error is thrown as a convenience so you can more easily
      // find the source for a warning that appears in the console by
      // enabling "pause on exceptions" in your JavaScript debugger.
      throw new Error(message);
      // eslint-disable-next-line no-empty
    } catch (e) {}
  }
}

const alreadyWarned: Record<string, boolean> = {};
export function warningOnce(key: string, cond: boolean, message: string) {
  if (!cond && !alreadyWarned[key]) {
    alreadyWarned[key] = true;
    warning(false, message);
  }
}

/**
 * Returns a resolved path object relative to the given pathname.
 *
 * @see https://reactrouter.com/docs/en/v6/api#resolvepath
 */
export function resolvePath(to: To, fromPathname = "/"): Path {
  let {
    pathname: toPathname,
    search = "",
    hash = "",
  } = typeof to === "string" ? parsePath(to) : to;

  let pathname = toPathname
    ? toPathname.startsWith("/")
      ? toPathname
      : resolvePathname(toPathname, fromPathname)
    : fromPathname;

  return {
    pathname,
    search: normalizeSearch(search),
    hash: normalizeHash(hash),
  };
}

function resolvePathname(relativePath: string, fromPathname: string): string {
  let segments = fromPathname.replace(/\/+$/, "").split("/");
  let relativeSegments = relativePath.split("/");

  relativeSegments.forEach((segment) => {
    if (segment === "..") {
      // Keep the root "" segment so the pathname starts at /
      if (segments.length > 1) segments.pop();
    } else if (segment !== ".") {
      segments.push(segment);
    }
  });

  return segments.length > 1 ? segments.join("/") : "/";
}

export function resolveTo(
  toArg: To,
  routePathnames: string[],
  locationPathname: string
): Path {
  let to = typeof toArg === "string" ? parsePath(toArg) : toArg;
  let toPathname = toArg === "" || to.pathname === "" ? "/" : to.pathname;

  // If a pathname is explicitly provided in `to`, it should be relative to the
  // route context. This is explained in `Note on `<Link to>` values` in our
  // migration guide from v5 as a means of disambiguation between `to` values
  // that begin with `/` and those that do not. However, this is problematic for
  // `to` values that do not provide a pathname. `to` can simply be a search or
  // hash string, in which case we should assume that the navigation is relative
  // to the current location's pathname and *not* the route pathname.
  let from: string;
  if (toPathname == null) {
    from = locationPathname;
  } else {
    let routePathnameIndex = routePathnames.length - 1;

    if (toPathname.startsWith("..")) {
      let toSegments = toPathname.split("/");

      // Each leading .. segment means "go up one route" instead of "go up one
      // URL segment".  This is a key difference from how <a href> works and a
      // major reason we call this a "to" value instead of a "href".
      while (toSegments[0] === "..") {
        toSegments.shift();
        routePathnameIndex -= 1;
      }

      to.pathname = toSegments.join("/");
    }

    // If there are more ".." segments than parent routes, resolve relative to
    // the root / URL.
    from = routePathnameIndex >= 0 ? routePathnames[routePathnameIndex] : "/";
  }

  let path = resolvePath(to, from);

  // Ensure the pathname has a trailing slash if the original to value had one.
  if (
    toPathname &&
    toPathname !== "/" &&
    toPathname.endsWith("/") &&
    !path.pathname.endsWith("/")
  ) {
    path.pathname += "/";
  }

  return path;
}

export function getToPathname(to: To): string | undefined {
  // Empty strings should be treated the same as / paths
  return to === "" || (to as Path).pathname === ""
    ? "/"
    : typeof to === "string"
    ? parsePath(to).pathname
    : to.pathname;
}

export const joinPaths = (paths: string[]): string =>
  paths.join("/").replace(/\/\/+/g, "/");

export const normalizePathname = (pathname: string): string =>
  pathname.replace(/\/+$/, "").replace(/^\/*/, "/");

export const normalizeSearch = (search: string): string =>
  !search || search === "?"
    ? ""
    : search.startsWith("?")
    ? search
    : "?" + search;

export const normalizeHash = (hash: string): string =>
  !hash || hash === "#" ? "" : hash.startsWith("#") ? hash : "#" + hash;