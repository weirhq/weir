// The Material Symbols the package bundles (scripts/fonts.ts cuts the font
// down to these). Add a name here and re-pin to use another icon.
export const iconNames = [
  'add',
  'arrow_back',
  'arrow_drop_down',
  'check',
  'close',
  'delete',
  'edit',
  'favorite',
  'home',
  'keyboard_arrow_down',
  'menu',
  'menu_open',
  'more_vert',
  'movie',
  'music_note',
  'pause',
  'play_arrow',
  'playlist_play',
  'queue_music',
  'search',
  'settings',
  'skip_next',
  'skip_previous',
  'tv'
] as const

export type IconName = (typeof iconNames)[number]
