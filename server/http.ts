// The fetch signature HTTP clients accept, so tests can inject a stub.
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
