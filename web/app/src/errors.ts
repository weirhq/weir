import { Code, ConnectError } from '@connectrpc/connect'

/** A sentence to show the user for a failed call. */
export function errorMessage(err: unknown): string {
  const e = ConnectError.from(err)
  switch (e.code) {
    case Code.Unauthenticated:
      return 'Wrong username or password.'
    case Code.ResourceExhausted:
      return 'Too many attempts. Try again in a minute.'
    case Code.InvalidArgument:
    case Code.FailedPrecondition:
    case Code.PermissionDenied:
    case Code.AlreadyExists:
      return capitalise(e.rawMessage)
    case Code.Unavailable:
    case Code.Unknown:
      return "Couldn't reach the server. Check your connection and try again."
    default:
      return 'Something went wrong. Try again.'
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1) + (s.endsWith('.') ? '' : '.')
}
