import { create } from '@bufbuild/protobuf'
import { timestampFromMs } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError, type ConnectRouter } from '@connectrpc/connect'
import {
  Admin,
  JobSchema,
  JobState,
  LibraryAccessSchema,
  type LibraryAccess,
  type UpdateLibraryRequest,
  type UpdateUserRequest
} from '../gen/weir/api/v1alpha/admin_pb'
import {
  LibraryKind,
  LibrarySchema,
  type Library
} from '../gen/weir/api/v1alpha/library_pb'
import { Role, UserSchema, type User } from '../gen/weir/api/v1alpha/user_pb'
import type { FakeAuth } from './fakeAuth'

/** An in-memory Admin server: two users, three libraries, a few jobs. */
export class FakeAdmin {
  users: User[] = [
    create(UserSchema, {
      id: 'u1',
      username: 'luna',
      displayName: 'Luna',
      role: Role.ADMIN
    }),
    create(UserSchema, {
      id: 'u2',
      username: 'ana',
      displayName: 'Ana',
      role: Role.MEMBER
    })
  ]
  libraries: Library[] = [
    create(LibrarySchema, {
      id: 'films',
      name: 'Films',
      kind: LibraryKind.MOVIES,
      paths: ['/media/films']
    }),
    create(LibrarySchema, {
      id: 'tv',
      name: 'TV',
      kind: LibraryKind.SHOWS,
      paths: ['/media/tv']
    }),
    create(LibrarySchema, {
      id: 'music',
      name: 'Music',
      kind: LibraryKind.MUSIC,
      paths: ['/media/music', '/media/more-music']
    })
  ]
  access: Record<string, LibraryAccess[]> = {
    u2: [
      create(LibraryAccessSchema, {
        libraryId: 'films',
        view: true,
        play: true
      })
    ]
  }
  jobs = [
    job('j3', 'scan_library', 'tv', JobState.RUNNING),
    job('j2', 'refresh_metadata', 'music', JobState.FAILED, {
      attempt: 3,
      error: 'musicbrainz: 503 Service Unavailable'
    }),
    job('j1', 'scan_library', 'films', JobState.COMPLETED)
  ]
  healthy = true
  problem = ''
  engineVersion = '0.1.0'
  scans: string[] = []
  userUpdates: UpdateUserRequest[] = []
  libraryUpdates: UpdateLibraryRequest[] = []
  // Admin calls fail until the fake's next sign-in, as after 10 minutes.
  #staleUntil: { auth: FakeAuth; logins: number } | undefined

  requireReauth(auth: FakeAuth) {
    this.#staleUntil = { auth, logins: auth.logins }
  }

  #check() {
    const s = this.#staleUntil
    if (s && s.auth.logins === s.logins)
      throw new ConnectError('sign in again to continue', Code.PermissionDenied)
  }

  register(router: ConnectRouter) {
    // Every method checks for a recent sign-in first, as the server does.
    const guard =
      <Req, Res>(fn: (req: Req) => Res) =>
      (req: Req) => {
        this.#check()
        return fn(req)
      }
    router.service(Admin, {
      listUsers: guard(() => ({ users: this.users })),
      createUser: guard((req) => {
        if (this.users.some((u) => u.username === req.username))
          throw new ConnectError('that username is taken', Code.AlreadyExists)
        const user = create(UserSchema, {
          id: `u${this.users.length + 1}`,
          username: req.username,
          displayName: req.displayName || req.username,
          role: req.role
        })
        this.users.push(user)
        return { user }
      }),
      updateUser: guard((req) => {
        this.userUpdates.push(req)
        const user = this.users.find((u) => u.id === req.id)!
        for (const f of req.updateMask?.paths ?? []) {
          if (f === 'display_name') user.displayName = req.displayName
          if (f === 'role') user.role = req.role
        }
        return { user }
      }),
      deleteUser: guard((req) => {
        this.users = this.users.filter((u) => u.id !== req.id)
        return {}
      }),
      listLibraries: guard(() => ({
        libraries: this.libraries,
        libraryPaths: ['/media']
      })),
      createLibrary: guard((req) => {
        const library = create(LibrarySchema, {
          id: `lib${this.libraries.length + 1}`,
          name: req.name,
          kind: req.kind,
          paths: req.paths
        })
        this.libraries.push(library)
        this.jobs.unshift(
          job(
            `j${this.jobs.length + 1}`,
            'scan_library',
            library.id,
            JobState.WAITING
          )
        )
        return { library }
      }),
      updateLibrary: guard((req) => {
        this.libraryUpdates.push(req)
        const library = this.libraries.find((l) => l.id === req.id)!
        library.name = req.name
        library.paths = req.paths
        return { library }
      }),
      deleteLibrary: guard((req) => {
        this.libraries = this.libraries.filter((l) => l.id !== req.id)
        return {}
      }),
      scanLibrary: guard((req) => {
        this.scans.push(req.id)
        this.jobs.unshift(
          job(
            `j${this.jobs.length + 1}`,
            'scan_library',
            req.id,
            JobState.WAITING
          )
        )
        return {}
      }),
      getLibraryAccess: guard((req) => ({
        access: this.access[req.userId] ?? []
      })),
      setLibraryAccess: guard((req) => {
        this.access[req.userId] = req.access
        return {}
      }),
      getServerStatus: guard(() => ({
        engine: {
          healthy: this.healthy,
          problem: this.problem,
          engineVersion: this.engineVersion,
          ffmpegVersion: '9.0.2',
          maxSessions: 4,
          activeSessions: 1,
          hardware: []
        },
        recentJobs: this.jobs
      }))
    })
  }
}

function job(
  id: string,
  kind: string,
  libraryId: string,
  state: JobState,
  o: { attempt?: number; error?: string } = {}
) {
  const done = state === JobState.COMPLETED || state === JobState.FAILED
  return create(JobSchema, {
    id,
    kind,
    libraryId,
    state,
    attempt: o.attempt ?? 1,
    createdAt: timestampFromMs(Date.UTC(2026, 9, 30, 14, 0)),
    finishedAt: done
      ? timestampFromMs(Date.UTC(2026, 9, 30, 14, 5))
      : undefined,
    error: o.error ?? ''
  })
}
