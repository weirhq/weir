import { Icon, IconButton } from '@weirhq/m3e'
import {
  cloneElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import styles from './Cards.module.css'

/**
 * A titled, horizontally scrolling row of cards, as Plex's are: the title
 * can link to everything in the row, and arrows scroll it a screenful at a
 * time where there's a pointer to hover with. Renders nothing when empty.
 */
export function Row({
  title,
  wide,
  narrow,
  link,
  children
}: {
  title: string
  /** 280px columns, for wide pictures. */
  wide?: boolean
  /** 120px columns, for people. */
  narrow?: boolean
  /** A link to all of it, such as a library sorted the same way; the row
      gives it the title as its content. */
  link?: ReactElement<{ className?: string; children?: ReactNode }>
  children: ReactNode[]
}) {
  const scroller = useRef<HTMLDivElement>(null)
  // Whether it's scrolled to its start or end; both while it all fits.
  const [edges, setEdges] = useState({ start: true, end: true })
  const empty = children.length === 0
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () =>
      setEdges({
        start: el.scrollLeft <= 1,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
      })
    el.addEventListener('scroll', update, { passive: true })
    // Fires once on observing, and again as the row or its cards change.
    const resize = new ResizeObserver(update)
    resize.observe(el)
    for (const card of el.children) resize.observe(card)
    return () => {
      el.removeEventListener('scroll', update)
      resize.disconnect()
    }
  }, [empty, children.length])
  if (empty) return null

  const scroll = (direction: 1 | -1) => {
    const el = scroller.current
    el?.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' })
  }
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.rowHead}>
        <h2 className={styles.heading}>
          {link
            ? cloneElement(link, {
                className: styles.seeAll,
                children: (
                  <>
                    {title}
                    <Icon name="keyboard_arrow_right" />
                  </>
                )
              })
            : title}
        </h2>
        {!(edges.start && edges.end) && (
          <div className={styles.arrows}>
            <IconButton
              icon="keyboard_arrow_left"
              label="Scroll back"
              disabled={edges.start}
              onClick={() => scroll(-1)}
            />
            <IconButton
              icon="keyboard_arrow_right"
              label="Scroll on"
              disabled={edges.end}
              onClick={() => scroll(1)}
            />
          </div>
        )}
      </div>
      <div
        ref={scroller}
        className={[styles.row, wide && styles.wide, narrow && styles.narrow]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </div>
    </section>
  )
}
