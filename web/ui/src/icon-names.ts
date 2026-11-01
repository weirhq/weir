// The Material Symbols the package bundles (scripts/fonts.ts cuts the font
// down to these). Add a name here and re-pin to use another icon.
export const iconNames = [
  'add',
  'arrow_back',
  'arrow_drop_down',
  'check',
  'close',
  'date_range',
  'delete',
  'edit',
  'favorite',
  'home',
  'keyboard',
  'keyboard_arrow_down',
  'keyboard_arrow_left',
  'keyboard_arrow_right',
  'menu',
  'menu_open',
  'more_vert',
  'movie',
  'music_note',
  'pause',
  'play_arrow',
  'playlist_play',
  'queue_music',
  'schedule',
  'search',
  'settings',
  'skip_next',
  'skip_previous',
  'tv'
] as const

export type IconName = (typeof iconNames)[number]
