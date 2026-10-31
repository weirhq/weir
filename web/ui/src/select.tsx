import { Select as Radix } from 'radix-ui'
import { useState } from 'react'
import { Icon } from './icon'
import styles from './menu.module.css'
import { StateLayer } from './state-layer'
import { FieldFrame, type FieldCommonProps } from './text-field'
import './tokens/menu.gen.css'
import './tokens/list.gen.css'

export type SelectOption = { value: string; label: string; disabled?: boolean }

export type SelectProps = Omit<
  FieldCommonProps,
  'trailingIcon' | 'prefix' | 'suffix'
> & {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  /** Shown when no option is chosen. */
  placeholder?: string
  disabled?: boolean
  /** Submits the value with a form under this name. */
  name?: string
  id?: string
  className?: string
}

/**
 * An M3 exposed dropdown menu: a text field showing the chosen option that
 * opens a menu of the others, as wide as the field. Radix handles focus,
 * keyboard, typeahead and placement.
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  name,
  id,
  className,
  ...frame
}: SelectProps) {
  const [open, setOpen] = useState(false)
  return (
    <Radix.Root
      value={value}
      onValueChange={onValueChange}
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      name={name}
    >
      <FieldFrame
        {...frame}
        id={id}
        className={className}
        boxControl
        onBoxPress={() => !disabled && setOpen(true)}
        trailingIcon={
          <Icon
            name="arrow_drop_down"
            className={open ? styles.open : undefined}
          />
        }
        control={(c) => (
          <Radix.Trigger asChild>
            <button
              type="button"
              id={c.id}
              ref={c.ref}
              className={c.className}
              aria-invalid={c['aria-invalid']}
              aria-describedby={c['aria-describedby']}
            >
              <Radix.Value placeholder={placeholder} />
            </button>
          </Radix.Trigger>
        )}
      />
      <Radix.Portal>
        <Radix.Content
          position="popper"
          collisionPadding={8}
          className={`${styles.menu} ${styles.select} md-comp-menu md-comp-list`}
        >
          <Radix.Viewport>
            {options.map((o) => (
              <Radix.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className={styles.item}
              >
                <StateLayer />
                <Radix.ItemText>{o.label}</Radix.ItemText>
              </Radix.Item>
            ))}
          </Radix.Viewport>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  )
}
