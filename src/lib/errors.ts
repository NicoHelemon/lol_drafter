export function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
}
export class RoomExpiredError extends Error {
  constructor() { super('This room has expired or is no longer available. Please create a new room.'); }
}

