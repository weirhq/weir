// Every component in every state, for checking in a browser:
//   pnpm --filter @weirhq/m3e demo
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AssistChip,
  BottomAppBar,
  BottomSheet,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  CircularProgressIndicator,
  ConnectedButtonGroup,
  DatePicker,
  DatePickerDialog,
  DateRangePicker,
  DateRangePickerDialog,
  type DateRange,
  Dialog,
  SplitButton,
  type ButtonProps,
  type ButtonSize,
  ExtendedFab,
  Fab,
  FabMenu,
  FabMenuItem,
  FilterChip,
  Icon,
  IconButton,
  type IconButtonProps,
  InputChip,
  LinearProgressIndicator,
  List,
  LoadingIndicator,
  MaterialShapes,
  toSvgPath,
  ListDivider,
  ListItem,
  Menu,
  MenuDivider,
  MenuItem,
  NavigationBar,
  NavigationItem,
  NavigationRail,
  iconNames,
  Radio,
  RichTooltip,
  Select,
  Slider,
  SnackbarHost,
  SnackbarProvider,
  SuggestionChip,
  Switch,
  Tab,
  TabLink,
  TabList,
  TabNav,
  TabPanel,
  Tabs,
  TextField,
  Tooltip,
  TopAppBar,
  useSnackbar,
  type TopAppBarProps
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

function DatePickers() {
  const [date, setDate] = useState<string | null>('2026-11-01')
  const [german, setGerman] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  return (
    <div className="pickers">
      <div className="picker-box" data-testid="date-picker">
        <DatePicker
          locale="en-US"
          value={date}
          onValueChange={setDate}
          isSelectable={(d) => new Date(d).getUTCDay() !== 0}
        />
      </div>
      <div className="picker-box" data-testid="date-picker-de">
        <DatePicker locale="de-DE" value={german} onValueChange={setGerman} />
      </div>
      <div className="column">
        <output data-testid="date-value">{date ?? 'none'}</output>
        <Button variant="tonal" onClick={() => setOpen(true)}>
          Pick a date
        </Button>
        <output data-testid="date-confirmed">{confirmed ?? 'none'}</output>
        <DatePickerDialog
          locale="en-US"
          open={open}
          onOpenChange={setOpen}
          value={confirmed}
          onConfirm={setConfirmed}
        />
      </div>
    </div>
  )
}

function DateRanges() {
  const [range, setRange] = useState<DateRange>({
    start: '2026-11-02',
    end: '2026-11-06'
  })
  const [open, setOpen] = useState(false)
  const [confirmed, setConfirmed] = useState<DateRange>({
    start: null,
    end: null
  })
  return (
    <div className="pickers">
      <div className="picker-box range-box" data-testid="date-range-picker">
        <DateRangePicker
          locale="en-US"
          value={range}
          onValueChange={setRange}
        />
      </div>
      <div className="column">
        <output data-testid="range-value">
          {range.start ?? '…'} to {range.end ?? '…'}
        </output>
        <Button variant="tonal" onClick={() => setOpen(true)}>
          Pick dates
        </Button>
        <output data-testid="range-confirmed">
          {confirmed.start ?? '…'} to {confirmed.end ?? '…'}
        </output>
        <DateRangePickerDialog
          locale="en-US"
          open={open}
          onOpenChange={setOpen}
          value={confirmed}
          onConfirm={setConfirmed}
        />
      </div>
    </div>
  )
}

function FabMenus() {
  const [open, setOpen] = useState<string>()
  const [chose, setChose] = useState('Nothing yet')
  const menu = (size: 'baseline' | 'medium' | 'large') => (
    <FabMenu
      key={size}
      open={open === size}
      onOpenChange={(o) => setOpen(o ? size : undefined)}
      label={`Create (${size})`}
      size={size}
    >
      <FabMenuItem icon="queue_music" onClick={() => setChose('Playlist')}>
        Playlist
      </FabMenuItem>
      <FabMenuItem icon="favorite" onClick={() => setChose('Favourite')}>
        Favourite
      </FabMenuItem>
      <FabMenuItem icon="edit" onClick={() => setChose('Note')}>
        Note
      </FabMenuItem>
    </FabMenu>
  )
  return (
    <div className="fab-menus">
      <output data-testid="fab-menu-result">{chose}</output>
      <div className="fab-menu-row">
        {menu('baseline')}
        {menu('medium')}
        {menu('large')}
      </div>
    </div>
  )
}

function Loading() {
  const [value, setValue] = useState(30)
  return (
    <div className="progress-demo">
      <div className="progress-circles">
        <LoadingIndicator aria-label="Loading" />
        <LoadingIndicator aria-label="Loading, contained" contained />
        <LoadingIndicator aria-label="Loading progress" value={value / 100} />
        <LoadingIndicator
          aria-label="Loading progress, contained"
          value={value / 100}
          contained
        />
      </div>
      <Slider
        aria-label="Loading value"
        value={value}
        onValueChange={setValue}
        valueLabel={(n) => `${Math.round(n)}%`}
      />
      <div className="shape-grid" data-testid="material-shapes">
        {Object.keys(MaterialShapes).map((name) => (
          <figure key={name} className="shape-cell">
            <svg viewBox="0 0 1 1" aria-hidden>
              <path
                d={toSvgPath(
                  MaterialShapes[name as keyof typeof MaterialShapes].cubics
                )}
              />
            </svg>
            <figcaption>{name}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}

function Progress() {
  const [value, setValue] = useState(40)
  const v = value / 100
  return (
    <div className="progress-demo">
      <Slider
        aria-label="Progress"
        value={value}
        onValueChange={setValue}
        valueLabel={(n) => `${Math.round(n)}%`}
      />
      <div className="progress-row">
        <LinearProgressIndicator aria-label="Flat" value={v} />
        <LinearProgressIndicator aria-label="Flat, indeterminate" />
        <LinearProgressIndicator aria-label="Wavy" value={v} wavy />
        <LinearProgressIndicator aria-label="Wavy, indeterminate" wavy />
      </div>
      <div className="progress-circles">
        <CircularProgressIndicator aria-label="Circular" value={v} />
        <CircularProgressIndicator aria-label="Circular, indeterminate" />
        <CircularProgressIndicator aria-label="Circular wavy" value={v} wavy />
        <CircularProgressIndicator
          aria-label="Circular wavy, indeterminate"
          wavy
        />
      </div>
    </div>
  )
}

function Navigation() {
  const items = [
    ['search', 'Search'],
    ['favorite', 'Favourites'],
    ['queue_music', 'Queue'],
    ['settings', 'Settings']
  ] as const
  const [bar, setBar] = useState('Search')
  const [wide, setWide] = useState('Favourites')
  const [rail, setRail] = useState('Search')
  const [open, setOpen] = useState(false)
  return (
    <div className="navigation-demo">
      <div className="nav-column">
        <NavigationBar aria-label="Bar">
          {items.map(([icon, label]) => (
            <NavigationItem
              key={label}
              icon={icon}
              label={label}
              selected={bar === label}
              onClick={() => setBar(label)}
            />
          ))}
        </NavigationBar>
        <NavigationBar aria-label="Bar, icons first" iconPosition="start">
          {items.slice(0, 3).map(([icon, label]) => (
            <NavigationItem
              key={label}
              icon={icon}
              label={label}
              selected={wide === label}
              onClick={() => setWide(label)}
            />
          ))}
        </NavigationBar>
      </div>
      <div className="rail-box">
        <NavigationRail
          aria-label="Rail"
          expanded={open}
          header={
            <>
              <IconButton
                icon={open ? 'arrow_back' : 'more_vert'}
                label={open ? 'Collapse' : 'Expand'}
                onClick={() => setOpen(!open)}
              />
              <Fab icon="edit" label="Compose" size="baseline" />
            </>
          }
        >
          {items.map(([icon, label]) => (
            <NavigationItem
              key={label}
              icon={icon}
              label={label}
              selected={rail === label}
              onClick={() => setRail(label)}
            />
          ))}
        </NavigationRail>
        <p className="rail-page">{rail}</p>
      </div>
    </div>
  )
}

function ScrollingBar(props: Omit<TopAppBarProps, 'scrollTarget'>) {
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const label = [
    props.size ?? 'small',
    props.align,
    props.scrollBehavior,
    props.subtitle && 'subtitle'
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <div
      ref={setBox}
      className="bar-box"
      data-testid={`bar-${label}`}
      aria-label={label}
      role="region"
    >
      <TopAppBar
        {...props}
        scrollTarget={box}
        navigationIcon={<IconButton icon="arrow_back" label="Back" />}
        actions={
          <>
            <IconButton icon="search" label="Search" />
            <IconButton icon="more_vert" label="More" />
          </>
        }
      />
      <div className="bar-content">
        {Array.from({ length: 30 }, (_, i) => (
          <p key={i}>Line {i + 1}</p>
        ))}
      </div>
    </div>
  )
}

function AppBars() {
  return (
    <div className="bars">
      <ScrollingBar title="Small" scrollBehavior="pinned" />
      <ScrollingBar
        title="Centred"
        subtitle="With a subtitle"
        align="center"
        scrollBehavior="pinned"
      />
      <ScrollingBar title="Enters always" scrollBehavior="enterAlways" />
      <ScrollingBar
        size="medium"
        title="Medium"
        scrollBehavior="exitUntilCollapsed"
      />
      <ScrollingBar
        size="medium"
        title="Medium"
        subtitle="With a subtitle"
        scrollBehavior="exitUntilCollapsed"
      />
      <ScrollingBar
        size="large"
        title="Large"
        scrollBehavior="exitUntilCollapsed"
      />
      <ScrollingBar
        size="large"
        title="Large, centred"
        subtitle="With a subtitle"
        align="center"
        scrollBehavior="exitUntilCollapsed"
      />
      <div className="bar-box bottom-box">
        <BottomAppBar
          aria-label="Bottom"
          actions={
            <>
              <IconButton icon="check" label="Done" />
              <IconButton icon="edit" label="Edit" />
              <IconButton icon="favorite" label="Favourite" />
            </>
          }
          fab={<Fab icon="add" label="Add" />}
        />
      </div>
    </div>
  )
}

function TabsDemo() {
  const [page, setPage] = useState('one')
  const many = [
    'Overview',
    'Films',
    'Shows',
    'Music',
    'Photos',
    'Audiobooks',
    'Podcasts',
    'Playlists',
    'Collections',
    'Settings'
  ]
  return (
    <div className="tabs-demo">
      <Tabs defaultValue="films">
        <TabList aria-label="Primary">
          <Tab value="films">Films</Tab>
          <Tab value="shows">Shows</Tab>
          <Tab value="music">Music</Tab>
        </TabList>
        <TabPanel value="films" className="tab-panel">
          Films panel
        </TabPanel>
        <TabPanel value="shows" className="tab-panel">
          Shows panel
        </TabPanel>
        <TabPanel value="music" className="tab-panel">
          Music panel
        </TabPanel>
      </Tabs>
      <Tabs defaultValue="search">
        <TabList aria-label="With icons">
          <Tab value="search" icon="search">
            Search
          </Tab>
          <Tab value="favorite" icon="favorite">
            Favourites
          </Tab>
          <Tab value="settings" icon="settings">
            Settings
          </Tab>
        </TabList>
      </Tabs>
      <Tabs defaultValue="search">
        <TabList aria-label="Leading icons">
          <Tab value="search" icon="search" iconPosition="leading">
            Search
          </Tab>
          <Tab value="favorite" icon="favorite" iconPosition="leading">
            Favourites
          </Tab>
        </TabList>
      </Tabs>
      <Tabs defaultValue="all">
        <TabList aria-label="Secondary" variant="secondary">
          <Tab value="all">All</Tab>
          <Tab value="unwatched">Unwatched</Tab>
          <Tab value="watched">Watched</Tab>
        </TabList>
      </Tabs>
      <Tabs defaultValue="Overview">
        <TabList aria-label="Scrollable" scrollable>
          {many.map((n) => (
            <Tab key={n} value={n}>
              {n}
            </Tab>
          ))}
        </TabList>
      </Tabs>
      <TabNav aria-label="Links">
        {['one', 'two', 'three'].map((p) => (
          <TabLink key={p} label={`Page ${p}`} selected={page === p}>
            <a
              href={`#${p}`}
              onClick={(e) => {
                e.preventDefault()
                setPage(p)
              }}
            />
          </TabLink>
        ))}
      </TabNav>
    </div>
  )
}

function Messages() {
  const show = useSnackbar()
  const [said, setSaid] = useState('Nothing yet')
  const report = (what: string) => (r: string) => setSaid(`${what}: ${r}`)
  return (
    <div className="row">
      <Button
        variant="tonal"
        onClick={() =>
          void show({ message: 'Added to Rainy day' }).then(report('Short'))
        }
      >
        Short
      </Button>
      <Button
        variant="tonal"
        onClick={() =>
          void show({ message: 'Deleted Films', actionLabel: 'Undo' }).then(
            report('Action')
          )
        }
      >
        With an action
      </Button>
      <Button
        variant="tonal"
        onClick={() =>
          void show({
            message: 'Access saved',
            withDismissAction: true,
            duration: 'long'
          }).then(report('Close'))
        }
      >
        With a close button
      </Button>
      <Button
        variant="tonal"
        onClick={() =>
          void show({
            message:
              'The engine stopped responding, so playback paused. It will start again by itself when the engine is back.',
            actionLabel: 'Open settings',
            withDismissAction: true
          }).then(report('Two lines'))
        }
      >
        Two lines
      </Button>
      <Button
        variant="tonal"
        onClick={() =>
          void show({
            message: 'Couldn’t reach the server.',
            actionLabel: 'Try again with a fresh connection',
            actionOnNewLine: true
          }).then(report('New line'))
        }
      >
        Action on a new line
      </Button>
      <output data-testid="snackbar-result">{said}</output>
      <Tooltip text="Queue">
        <IconButton icon="queue_music" label="Queue" />
      </Tooltip>
      <Tooltip text="A longer tooltip that wraps onto a second line">
        <IconButton icon="more_vert" label="Long tooltip" />
      </Tooltip>
      <RichTooltip
        title="Hardware"
        text="Nothing in use; the engine is converting on the processor."
      >
        <IconButton icon="settings" label="About hardware" />
      </RichTooltip>
      <RichTooltip
        title="Hardware"
        text="Nothing in use; the engine is converting on the processor."
        action={
          <Button variant="text" onClick={() => setSaid('Learn more')}>
            Learn more
          </Button>
        }
      >
        <IconButton icon="search" label="Hardware, with an action" />
      </RichTooltip>
      <RichTooltip text="Text only, no title or action.">
        <IconButton icon="edit" label="Text only" />
      </RichTooltip>
    </div>
  )
}

function Dialogs() {
  const [basic, setBasic] = useState(false)
  const [withIcon, setWithIcon] = useState(false)
  const [form, setForm] = useState(false)
  const [long, setLong] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [name, setName] = useState('')
  const [said, setSaid] = useState('Nothing yet')
  const close = (what: string) => () => {
    setSaid(what)
    setBasic(false)
    setWithIcon(false)
    setForm(false)
    setLong(false)
  }
  return (
    <div className="row">
      <Button variant="tonal" onClick={() => setBasic(true)}>
        Basic
      </Button>
      <Button variant="tonal" onClick={() => setWithIcon(true)}>
        With an icon
      </Button>
      <Button variant="tonal" onClick={() => setForm(true)}>
        With a form
      </Button>
      <Button variant="tonal" onClick={() => setLong(true)}>
        Long
      </Button>
      <Button variant="tonal" onClick={() => setSheet(true)}>
        Bottom sheet
      </Button>
      <output data-testid="dialog-result">{said}</output>
      <Dialog
        open={basic}
        onOpenChange={setBasic}
        title="Discard draft?"
        actions={
          <>
            <Button variant="text" onClick={close('Cancelled')}>
              Cancel
            </Button>
            <Button variant="text" onClick={close('Discarded')}>
              Discard
            </Button>
          </>
        }
      />
      <Dialog
        open={withIcon}
        onOpenChange={setWithIcon}
        icon="delete"
        title="Delete this library?"
        description="Its items leave the server; files on disk are not touched."
        actions={
          <>
            <Button variant="text" onClick={close('Kept')}>
              Cancel
            </Button>
            <Button variant="text" onClick={close('Deleted')}>
              Delete
            </Button>
          </>
        }
      />
      <Dialog
        open={form}
        onOpenChange={setForm}
        title="Rename playlist"
        actions={
          <>
            <Button variant="text" onClick={close('Not renamed')}>
              Cancel
            </Button>
            <Button variant="text" type="submit" form="rename">
              Rename
            </Button>
          </>
        }
      >
        <form
          id="rename"
          onSubmit={(e) => {
            e.preventDefault()
            close(`Renamed to ${name}`)()
          }}
        >
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </form>
      </Dialog>
      <Dialog
        open={long}
        onOpenChange={setLong}
        title="Terms"
        description={'All work and no play makes a long dialog. '.repeat(60)}
        actions={
          <>
            <Button variant="text" onClick={close('Declined')}>
              Decline every one of the terms and conditions
            </Button>
            <Button variant="text" onClick={close('Accepted')}>
              Accept every one of the terms and conditions
            </Button>
          </>
        }
      />
      <BottomSheet open={sheet} onOpenChange={setSheet} title="Share">
        <List aria-label="Share to" className="in-sheet">
          {['Copy link', 'Email', 'Messages', 'Nearby'].map((n) => (
            <ListItem
              key={n}
              leading="add"
              headline={n}
              onClick={() => {
                setSaid(`Shared by ${n}`)
                setSheet(false)
              }}
            />
          ))}
        </List>
      </BottomSheet>
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

      <section aria-labelledby="date-pickers">
        <h2 id="date-pickers">Date pickers</h2>
        <DatePickers />
      </section>

      <section aria-labelledby="date-ranges">
        <h2 id="date-ranges">Date range pickers</h2>
        <DateRanges />
      </section>

      <section aria-labelledby="fab-menu">
        <h2 id="fab-menu">FAB menu</h2>
        <FabMenus />
      </section>

      <section aria-labelledby="loading">
        <h2 id="loading">Loading indicator and shapes</h2>
        <Loading />
      </section>

      <section aria-labelledby="progress">
        <h2 id="progress">Progress</h2>
        <Progress />
      </section>

      <section aria-labelledby="navigation">
        <h2 id="navigation">Navigation</h2>
        <Navigation />
      </section>

      <section aria-labelledby="app-bars">
        <h2 id="app-bars">App bars</h2>
        <AppBars />
      </section>

      <section aria-labelledby="tabs">
        <h2 id="tabs">Tabs</h2>
        <TabsDemo />
      </section>

      <section aria-labelledby="messages">
        <h2 id="messages">Snackbars and tooltips</h2>
        <Messages />
      </section>

      <section aria-labelledby="dialogs">
        <h2 id="dialogs">Dialogs and sheets</h2>
        <Dialogs />
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
    <SnackbarProvider>
      <Demo />
      <SnackbarHost />
    </SnackbarProvider>
  </StrictMode>
)
