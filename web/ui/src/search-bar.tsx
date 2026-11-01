import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from 'react'
import { Icon } from './icon'
import { IconButton } from './icon-button'
import styles from './search-bar.module.css'
import './tokens/search-bar.gen.css'
import './tokens/search-view.gen.css'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

export type SearchBarProps = {
  value: string
  onValueChange: (value: string) => void
  /** Enter: search for what's typed. */
  onSearch?: (value: string) => void
  placeholder?: string
  /** Its accessible name; the placeholder, or "Search", by default. */
  label?: string
  /** Before the text while collapsed; a search icon by default. */
  leading?: ReactNode
  /** After the text while collapsed, such as an avatar. */
  trailing?: ReactNode
  /**
   * Showing its results. A touch on the bar or the Down key asks to expand;
   * Escape, the back button or a press outside asks to collapse. Expanding
   * as the user types is up to the app.
   */
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  /**
   * Expanded, the bar grows down into a card (docked, for wide windows) or
   * covers the window (for phones).
   */
  expandsTo?: 'docked' | 'fullScreen'
  /** Results or suggestions, shown while expanded. */
  children?: ReactNode
  className?: string
}

/**
 * An M3 search bar (Compose's SearchBar, with ExpandedDockedSearchBar and
 * ExpandedFullScreenSearchBar): a 56dp pill that expands into a view of
 * results under its input. The input stays the same element throughout, so
 * typing carries on as it expands.
 */
export function SearchBar({
  value,
  onValueChange,
  onSearch,
  placeholder,
  label,
  leading,
  trailing,
  expanded = false,
  onExpandedChange,
  expandsTo = 'docked',
  children,
  className
}: SearchBarProps) {
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const results = useId()
  const open = expanded && children !== undefined && children !== null
  const fullScreen = open && expandsTo === 'fullScreen'

  // A press outside collapses it, as Compose's popup dismisses.
  useEffect(() => {
    if (!open) return
    const press = (e: globalThis.PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onExpandedChange?.(false)
    }
    document.addEventListener('pointerdown', press)
    return () => document.removeEventListener('pointerdown', press)
  }, [open, onExpandedChange])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSearch?.(value)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!expanded) onExpandedChange?.(true)
      else
        root.current
          ?.querySelector<HTMLElement>(
            `#${CSS.escape(results)} :is(a, button, input, [tabindex="0"])`
          )
          ?.focus()
    }
  }
  // Touch expands, where a keyboard comes up anyway; a mouse just types.
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' && !expanded) onExpandedChange?.(true)
  }

  return (
    <div
      ref={root}
      className={cx(
        styles.root,
        'md-comp-search-bar',
        'md-comp-search-view',
        className
      )}
    >
      <div
        className={cx(
          styles.surface,
          open && styles.open,
          fullScreen && styles.fullScreen
        )}
        onKeyDown={(e) => {
          // Escape collapses, rather than clearing the field as browsers
          // do, which would only expand an app that expands on typing.
          if (e.key === 'Escape' && open) {
            e.preventDefault()
            onExpandedChange?.(false)
            input.current?.focus()
          }
        }}
      >
        <form role="search" className={styles.field} onSubmit={submit}>
          <span className={styles.leading}>
            {open ? (
              // Not submit buttons, which Enter in the field would press.
              <IconButton
                type="button"
                icon="arrow_back"
                label="Close search"
                onClick={() => {
                  onExpandedChange?.(false)
                  input.current?.focus()
                }}
              />
            ) : (
              (leading ?? <Icon name="search" />)
            )}
          </span>
          <input
            ref={input}
            className={styles.input}
            type="search"
            value={value}
            placeholder={placeholder}
            aria-label={label ?? placeholder ?? 'Search'}
            aria-expanded={children !== undefined ? open : undefined}
            aria-controls={open ? results : undefined}
            autoComplete="off"
            enterKeyHint="search"
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
          />
          {open
            ? value && (
                <span className={cx(styles.trailing, styles.clear)}>
                  <IconButton
                    type="button"
                    icon="close"
                    label="Clear"
                    onClick={() => {
                      onValueChange('')
                      input.current?.focus()
                    }}
                  />
                </span>
              )
            : trailing && <span className={styles.trailing}>{trailing}</span>}
        </form>
        {open && (
          <>
            <hr className={styles.divider} />
            <div id={results} className={styles.results}>
              {children}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export type AppBarWithSearchProps = {
  /** Before the search bar, such as a menu button. */
  navigationIcon?: ReactNode
  /** After the search bar, such as an avatar or a few icon buttons. */
  actions?: ReactNode
  /** The SearchBar. */
  children: ReactNode
  className?: string
}

/**
 * An M3 app bar around a search bar (Compose's AppBarWithSearch): the bar
 * between 360 and 720dp wide, centred, 8dp from its neighbours and 4dp
 * from the top and bottom.
 */
export function AppBarWithSearch({
  navigationIcon,
  actions,
  children,
  className
}: AppBarWithSearchProps) {
  return (
    <header className={cx(styles.appBar, className)}>
      {navigationIcon && <div className={styles.nav}>{navigationIcon}</div>}
      <div className={styles.searchSlot}>{children}</div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  )
}
