// Every component in every state, for checking in a browser:
//   pnpm --filter @weirhq/m3e demo
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Button,
  type ButtonProps,
  type ButtonSize,
  Icon,
  iconNames
} from '../src'
import '../src/tokens.gen.css'
import '../src/styles.css'
import './demo.css'

const sizes: ButtonSize[] = ['xs', 's', 'm', 'l', 'xl']
const variants = ['filled', 'tonal', 'elevated', 'outlined', 'text'] as const
const toggleVariants = ['filled', 'tonal', 'elevated', 'outlined'] as const

function Toggle(
  props: Omit<ButtonProps, 'selected' | 'onClick' | 'variant'> & {
    variant: (typeof toggleVariants)[number]
  }
) {
  const [selected, setSelected] = useState(false)
  return (
    <Button
      {...props}
      selected={selected}
      onClick={() => setSelected(!selected)}
    />
  )
}

function Demo() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return (
    <main>
      <header>
        <h1>@weirhq/m3e</h1>
        <Button
          variant="tonal"
          icon="settings"
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        >
          {theme === 'light' ? 'Dark' : 'Light'} theme
        </Button>
      </header>

      <section aria-labelledby="buttons">
        <h2 id="buttons">Buttons</h2>
        {variants.map((variant) => (
          <div className="row" key={variant} data-testid={`buttons-${variant}`}>
            <span className="label">{variant}</span>
            {sizes.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {size.toUpperCase()}
              </Button>
            ))}
            <Button variant={variant} icon="add">
              Icon
            </Button>
            <Button variant={variant} shape="square">
              Square
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
          </div>
        ))}
      </section>

      <section aria-labelledby="toggles">
        <h2 id="toggles">Toggle buttons</h2>
        {toggleVariants.map((variant) => (
          <div className="row" key={variant} data-testid={`toggles-${variant}`}>
            <span className="label">{variant}</span>
            <Toggle variant={variant} icon="favorite">
              Round
            </Toggle>
            <Toggle variant={variant} shape="square" icon="favorite">
              Square
            </Toggle>
            <Button variant={variant} selected icon="check">
              Selected
            </Button>
            <Button variant={variant} selected disabled>
              Selected, disabled
            </Button>
            <Toggle variant={variant} size="m" icon="favorite">
              Medium
            </Toggle>
          </div>
        ))}
      </section>

      <section aria-labelledby="links">
        <h2 id="links">As a link</h2>
        <div className="row">
          <Button asChild icon="arrow_back">
            <a href="#buttons">Back to buttons</a>
          </Button>
          <Button asChild variant="text">
            <a href="#icons">Icons</a>
          </Button>
        </div>
      </section>

      <section aria-labelledby="icons">
        <h2 id="icons">Icons</h2>
        <div className="row icons">
          {iconNames.map((name) => (
            <span key={name} className="icon">
              <Icon name={name} />
              <Icon name={name} filled />
              <code>{name}</code>
            </span>
          ))}
        </div>
      </section>

      <section aria-labelledby="elevation">
        <h2 id="elevation">Elevation</h2>
        <div className="row">
          {[0, 1, 2, 3, 4, 5].map((level) => (
            <div
              key={level}
              className="surface"
              style={{
                boxShadow: `var(--md-sys-elevation-shadow-level${level})`
              }}
            >
              Level {level}
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>
)
