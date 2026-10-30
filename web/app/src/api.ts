import { createClient, type Client, type Transport } from '@connectrpc/connect'
import { Auth } from './gen/weir/api/v1alpha/auth_pb'
import { Browse } from './gen/weir/api/v1alpha/browse_pb'
import { Playback } from './gen/weir/api/v1alpha/playback_pb'
import { Playlists } from './gen/weir/api/v1alpha/playlists_pb'

/** The API clients the app uses, all on one authenticated transport. */
export type Api = {
  auth: Client<typeof Auth>
  browse: Client<typeof Browse>
  playback: Client<typeof Playback>
  playlists: Client<typeof Playlists>
}

export function createApi(transport: Transport): Api {
  return {
    auth: createClient(Auth, transport),
    browse: createClient(Browse, transport),
    playback: createClient(Playback, transport),
    playlists: createClient(Playlists, transport)
  }
}
