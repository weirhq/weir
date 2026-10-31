// Every component in every state, for checking in a browser:
//   pnpm --filter @weirhq/m3e demo
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Button,
  ButtonGroup,
  ConnectedButtonGroup,
  SplitButton,
  type ButtonProps,
  type ButtonSize,
  ExtendedFab,
  Fab,
  Icon,
  IconButton,
  type IconButtonProps,
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

function IconToggle(props: Omit<IconButtonProps, 'selected' | 'onClick'>) {
  const [selected, setSelected] = useState(false)
  return (
    <IconButton
      {...props}
      selected={selected}
      onClick={() => setSelected(!selected)}
    />
  )
}

const iconVariants = ['standard', 'filled', 'tonal', 'outlined'] as const

function Choice({ size }: { size: ButtonSize }) {
  const [view, setView] = useState('Week')
  return (
    <ConnectedButtonGroup label={`View, ${size}`}>
      {['Day', 'Week', 'Month'].map((v) => (
        <Button
          key={v}
          variant="tonal"
          size={size}
          selected={view === v}
          onClick={() => setView(v)}
        >
          {v}
        </Button>
      ))}
    </ConnectedButtonGroup>
  )
}

function Split(props: {
  variant: 'filled' | 'tonal' | 'elevated' | 'outlined'
  size: ButtonSize
}) {
  const [open, setOpen] = useState(false)
  return (
    <SplitButton
      {...props}
      icon="edit"
      menuLabel={`More edit options, ${props.variant} ${props.size}`}
      menuOpen={open}
      onMenuClick={() => setOpen(!open)}
    >
      Edit
    </SplitButton>
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

      <section aria-labelledby="icon-buttons">
        <h2 id="icon-buttons">Icon buttons</h2>
        {iconVariants.map((variant) => (
          <div
            className="row"
            key={variant}
            data-testid={`icon-buttons-${variant}`}
          >
            <span className="label">{variant}</span>
            {sizes.map((size) => (
              <IconButton
                key={size}
                variant={variant}
                size={size}
                icon="play_arrow"
                label={`Play ${size}`}
              />
            ))}
            <IconButton
              variant={variant}
              width="narrow"
              icon="skip_previous"
              label="Narrow"
            />
            <IconButton
              variant={variant}
              width="wide"
              icon="skip_next"
              label="Wide"
            />
            <IconButton
              variant={variant}
              shape="square"
              icon="settings"
              label="Square"
            />
            <IconToggle variant={variant} icon="favorite" label="Favourite" />
            <IconToggle
              variant={variant}
              shape="square"
              icon="favorite"
              label="Favourite, square"
            />
            <IconButton
              variant={variant}
              icon="delete"
              label="Disabled"
              disabled
            />
          </div>
        ))}
      </section>

      <section aria-labelledby="fabs">
        <h2 id="fabs">Floating action buttons</h2>
        {(['primary', 'secondary'] as const).map((color) => (
          <div className="row" key={color} data-testid={`fabs-${color}`}>
            <span className="label">{color}</span>
            {(['small', 'baseline', 'medium', 'large'] as const).map((size) => (
              <Fab
                key={size}
                color={color}
                size={size}
                icon="add"
                label={`New, ${size}`}
              />
            ))}
            {(['small', 'medium', 'large'] as const).map((size) => (
              <ExtendedFab key={size} color={color} size={size} icon="edit">
                Extended {size}
              </ExtendedFab>
            ))}
          </div>
        ))}
      </section>

      <section aria-labelledby="groups">
        <h2 id="groups">Button groups</h2>
        <div className="row" data-testid="group-buttons">
          <ButtonGroup label="Formatting">
            <Button variant="tonal">Bold</Button>
            <Button variant="tonal">Italic</Button>
            <Button variant="tonal">Underline</Button>
          </ButtonGroup>
          <ButtonGroup label="Transport">
            <IconButton variant="tonal" icon="skip_previous" label="Previous" />
            <IconButton
              variant="filled"
              width="wide"
              icon="play_arrow"
              label="Play"
            />
            <IconButton variant="tonal" icon="skip_next" label="Next" />
          </ButtonGroup>
        </div>
        {(['xs', 's', 'm'] as const).map((size) => (
          <div className="row" key={size} data-testid={`connected-${size}`}>
            <span className="label">connected {size}</span>
            <Choice size={size} />
          </div>
        ))}
      </section>

      <section aria-labelledby="splits">
        <h2 id="splits">Split buttons</h2>
        {toggleVariants.map((variant) => (
          <div className="row" key={variant} data-testid={`splits-${variant}`}>
            <span className="label">{variant}</span>
            {sizes.map((size) => (
              <Split key={size} variant={variant} size={size} />
            ))}
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
