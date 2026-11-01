// Every component in every state, for checking in a browser:
//   pnpm --filter @weirhq/m3e demo
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AssistChip,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  ConnectedButtonGroup,
  SplitButton,
  type ButtonProps,
  type ButtonSize,
  ExtendedFab,
  Fab,
  FilterChip,
  Icon,
  IconButton,
  type IconButtonProps,
  InputChip,
  List,
  ListDivider,
  ListItem,
  Menu,
  MenuDivider,
  MenuItem,
  iconNames,
  Radio,
  Select,
  Slider,
  SuggestionChip,
  Switch,
  TextField
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

function Filters({ morph = false }: { morph?: boolean }) {
  const [on, setOn] = useState<string[]>(['Films'])
  return (
    <>
      {['Films', 'Shows', 'Music'].map((f) => (
        <FilterChip
          key={f}
          morph={morph}
          selected={on.includes(f)}
          onClick={() =>
            setOn(on.includes(f) ? on.filter((x) => x !== f) : [...on, f])
          }
        >
          {f}
        </FilterChip>
      ))}
      <FilterChip
        morph={morph}
        selected={false}
        trailingIcon="keyboard_arrow_down"
      >
        Sort
      </FilterChip>
      <FilterChip morph={morph} selected disabled>
        Disabled
      </FilterChip>
    </>
  )
}

function People() {
  const [people, setPeople] = useState(['Ana', 'Bea', 'Cai'])
  const avatar = (name: string) => (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect
        width="24"
        height="24"
        fill="var(--md-sys-color-tertiary-container)"
      />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fontSize="12"
        fill="var(--md-sys-color-on-tertiary-container)"
      >
        {name[0]}
      </text>
    </svg>
  )
  return (
    <>
      {people.map((p, i) => (
        <InputChip
          key={p}
          avatar={i === 0 ? avatar(p) : undefined}
          icon={i === 1 ? 'favorite' : undefined}
          morph={i === 2}
          onRemove={() => setPeople(people.filter((x) => x !== p))}
        >
          {p}
        </InputChip>
      ))}
      <InputChip selected onRemove={() => {}}>
        Selected
      </InputChip>
      <InputChip disabled onRemove={() => {}}>
        Disabled
      </InputChip>
    </>
  )
}

function Sliders() {
  const [volume, setVolume] = useState(40)
  const [quality, setQuality] = useState(50)
  const [rating, setRating] = useState(3)
  return (
    <div className="sliders">
      <Slider
        aria-label="Volume"
        value={volume}
        onValueChange={setVolume}
        valueLabel={(v) => `${Math.round(v)}`}
      />
      <Slider
        aria-label="Quality"
        value={quality}
        onValueChange={setQuality}
        step={25}
        valueLabel={(v) => `${v}%`}
      />
      <Slider
        aria-label="Rating"
        value={rating}
        onValueChange={setRating}
        min={0}
        max={5}
        step={1}
      />
      <Slider
        aria-label="Disabled"
        value={60}
        onValueChange={() => {}}
        disabled
      />
    </div>
  )
}

function Fields({ variant }: { variant: 'filled' | 'outlined' }) {
  const [price, setPrice] = useState('')
  return (
    <div className="fields" data-testid={`fields-${variant}`}>
      <TextField variant={variant} label="Title" />
      <TextField variant={variant} label="Filled in" defaultValue="Arrival" />
      <TextField
        variant={variant}
        label="Search"
        leadingIcon="search"
        trailingIcon={
          <IconButton icon="close" label="Clear" onClick={() => {}} />
        }
        placeholder="Films, shows, music"
      />
      <TextField
        variant={variant}
        label="Price"
        prefix="£"
        suffix="per month"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        supportingText="Billed monthly"
      />
      <TextField
        variant={variant}
        label="Username"
        defaultValue="a"
        error="At least three characters"
      />
      <TextField variant={variant} label="Disabled" disabled defaultValue="x" />
      <TextField
        variant={variant}
        label="Notes"
        multiline
        rows={3}
        supportingText="Multi-line"
      />
      <TextField variant={variant} placeholder="No label" />
    </div>
  )
}

function Menus() {
  const [last, setLast] = useState('nothing yet')
  const [kind, setKind] = useState('movies')
  const [quality, setQuality] = useState('')
  const kinds = [
    { value: 'movies', label: 'Films' },
    { value: 'shows', label: 'Shows' },
    { value: 'music', label: 'Music' },
    { value: 'photos', label: 'Photos', disabled: true }
  ]
  return (
    <div className="row" data-testid="menus">
      <Menu trigger={<IconButton icon="more_vert" label="More" />}>
        <MenuItem icon="edit" onSelect={() => setLast('Rename')}>
          Rename
        </MenuItem>
        <MenuItem
          icon="queue_music"
          trailingIcon={<span>⌘P</span>}
          onSelect={() => setLast('Add to playlist')}
        >
          Add to playlist
        </MenuItem>
        <MenuDivider />
        <MenuItem icon="delete" disabled>
          Delete
        </MenuItem>
      </Menu>
      <span>Chose: {last}</span>
      <div className="fields">
        <Select
          label="Kind"
          value={kind}
          onValueChange={setKind}
          options={kinds}
        />
        <Select
          variant="filled"
          label="Quality"
          leadingIcon="settings"
          placeholder="Pick one"
          value={quality}
          onValueChange={setQuality}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'original', label: 'Original' }
          ]}
          supportingText="Filled, with an icon"
        />
        <Select
          label="Disabled"
          value="movies"
          onValueChange={() => {}}
          options={kinds}
          disabled
        />
      </div>
    </div>
  )
}

function Cards() {
  const [opened, setOpened] = useState(0)
  const body = (title: string, text: string) => (
    <>
      <span className="card-title">{title}</span>
      <span className="card-text">{text}</span>
    </>
  )
  return (
    <div className="cards">
      {(['filled', 'elevated', 'outlined'] as const).map((v) => (
        <div key={v} className="column" data-testid={`cards-${v}`}>
          <Card variant={v} aria-label={`Static ${v}`} role="group">
            {body(
              v[0]!.toUpperCase() + v.slice(1),
              'Content about one subject'
            )}
          </Card>
          <Card variant={v} onClick={() => setOpened(opened + 1)}>
            {body('Clickable', `Opened ${opened} times`)}
          </Card>
          <Card variant={v} asChild>
            <a href="#cards">{body('A link', 'Goes to #cards')}</a>
          </Card>
          <Card variant={v} onClick={() => {}} disabled>
            {body('Disabled', 'Can’t be pressed')}
          </Card>
        </div>
      ))}
    </div>
  )
}

function Lists() {
  const [picked, setPicked] = useState('Wi-Fi')
  const [seg, setSeg] = useState('Week')
  const avatar = (
    <span className="avatar" aria-hidden>
      A
    </span>
  )
  return (
    <div className="row lists">
      <List aria-label="Plain" data-testid="list-plain">
        <ListItem leading="settings" headline="One line" trailingText="100+" />
        <ListItem
          leading={avatar}
          headline="Two lines"
          supporting="Supporting text"
          trailing={<IconButton icon="more_vert" label="More" />}
        />
        <ListDivider />
        <ListItem
          overline="Overline"
          headline="Three lines"
          supporting="Supporting text"
        />
        <ListItem
          headline="Three lines"
          supporting="Supporting text that wraps onto a second line"
          threeLine
        />
      </List>
      <List aria-label="Interactive" data-testid="list-interactive">
        {['Wi-Fi', 'Bluetooth', 'Cast'].map((n) => (
          <ListItem
            key={n}
            leading="settings"
            headline={n}
            supporting={n === picked ? 'Selected' : undefined}
            selected={n === picked}
            onClick={() => setPicked(n)}
          />
        ))}
        <ListItem headline="Disabled" disabled onClick={() => {}} />
      </List>
      <List aria-label="Segmented" segmented data-testid="list-segmented">
        {['Day', 'Week', 'Month'].map((n) => (
          <ListItem
            key={n}
            headline={n}
            selected={n === seg}
            onClick={() => setSeg(n)}
          />
        ))}
      </List>
    </div>
  )
}

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

      <section aria-labelledby="selection">
        <h2 id="selection">Selection</h2>
        <div className="row" data-testid="checkboxes">
          <span className="label">checkbox</span>
          <label className="control">
            <Checkbox /> Off
          </label>
          <label className="control">
            <Checkbox defaultChecked /> On
          </label>
          <label className="control">
            <Checkbox indeterminate /> Some
          </label>
          <label className="control">
            <Checkbox disabled /> Disabled
          </label>
          <label className="control">
            <Checkbox disabled defaultChecked /> Disabled, on
          </label>
        </div>
        <div className="row" data-testid="radios">
          <span className="label">radio</span>
          {['Auto', 'Original', 'Data saver'].map((v, i) => (
            <label className="control" key={v}>
              <Radio name="quality" value={v} defaultChecked={i === 0} /> {v}
            </label>
          ))}
          <label className="control">
            <Radio disabled /> Disabled
          </label>
          <label className="control">
            <Radio disabled defaultChecked /> Disabled, on
          </label>
        </div>
        <div className="row" data-testid="sliders">
          <span className="label">slider</span>
          <Sliders />
        </div>
        <div className="row" data-testid="switches">
          <span className="label">switch</span>
          <label className="control">
            <Switch /> Off
          </label>
          <label className="control">
            <Switch defaultChecked /> On
          </label>
          <label className="control">
            <Switch icons /> Icons
          </label>
          <label className="control">
            <Switch icons defaultChecked /> Icons, on
          </label>
          <label className="control">
            <Switch disabled /> Disabled
          </label>
          <label className="control">
            <Switch disabled defaultChecked /> Disabled, on
          </label>
        </div>
      </section>

      <section aria-labelledby="chips">
        <h2 id="chips">Chips</h2>
        <div className="row" data-testid="chips-assist">
          <span className="label">assist</span>
          <AssistChip icon="add">Add to playlist</AssistChip>
          <AssistChip>No icon</AssistChip>
          <AssistChip icon="favorite" elevated>
            Elevated
          </AssistChip>
          <AssistChip icon="add" disabled>
            Disabled
          </AssistChip>
          <AssistChip icon="add" elevated disabled>
            Elevated, disabled
          </AssistChip>
        </div>
        <div className="row" data-testid="chips-suggestion">
          <span className="label">suggestion</span>
          <SuggestionChip>Arrival</SuggestionChip>
          <SuggestionChip icon="search">Zodiac</SuggestionChip>
          <SuggestionChip elevated>Elevated</SuggestionChip>
          <SuggestionChip disabled>Disabled</SuggestionChip>
        </div>
        <div className="row" data-testid="chips-filter">
          <span className="label">filter</span>
          <Filters />
        </div>
        <div className="row" data-testid="chips-filter-morph">
          <span className="label">filter, morph</span>
          <Filters morph />
        </div>
        <div className="row" data-testid="chips-input">
          <span className="label">input</span>
          <People />
        </div>
      </section>

      <section aria-labelledby="text-fields">
        <h2 id="text-fields">Text fields</h2>
        <div className="row">
          <Fields variant="filled" />
          <Fields variant="outlined" />
        </div>
      </section>

      <section aria-labelledby="menus">
        <h2 id="menus">Menus</h2>
        <Menus />
      </section>

      <section aria-labelledby="cards">
        <h2 id="cards">Cards</h2>
        <Cards />
      </section>

      <section aria-labelledby="lists">
        <h2 id="lists">Lists</h2>
        <Lists />
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
