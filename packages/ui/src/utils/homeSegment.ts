// The community home's selected segment ("Feed | Groups"), kept for the session: per
// process, so a host that unmounts the feed screen (a tab navigator) gets it back.
export type HomeSegment = "feed" | "groups";

let current: HomeSegment = "feed";

export function homeSegment(): HomeSegment {
  return current;
}

export function rememberHomeSegment(segment: HomeSegment): void {
  current = segment;
}
