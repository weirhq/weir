import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import {
  AssistChip,
  BottomAppBar,
  BottomSheet,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  ConnectedButtonGroup,
  Dialog,
  ExtendedFab,
  Fab,
  FilterChip,
  IconButton,
  InputChip,
  List,
  ListDivider,
  ListItem,
  Menu,
  MenuItem,
  NavigationBar,
  NavigationItem,
  NavigationRail,
  Radio,
  RichTooltip,
  Select,
  Slider,
  Snackbar,
  SnackbarHost,
  SnackbarProvider,
  SplitButton,
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
  type SnackbarOptions,
  type SnackbarResult
} from '.'

it('renders button variants and passes props through', () => {
  render(
    <Button variant="tonal" type="submit">
      Save
    </Button>
  )
  const button = screen.getByRole('button', { name: 'Save' })
  expect(button.getAttribute('type')).toBe('submit')
  expect(button.className).toMatch(/tonal/)
})

it('renders its child instead of a button with asChild', () => {
  render(
    <Button asChild variant="text">
      <a href="/help">Help</a>
    </Button>
  )
  const link = screen.getByRole('link', { name: 'Help' })
  expect(link.className).toMatch(/text/)
  // The state layer still lands inside the link.
  expect(link.querySelector('[aria-hidden]')).not.toBeNull()
})

it('picks up the tokens for its size and variant', () => {
  render(
    <Button variant="outlined" size="l" shape="square">
      Play
    </Button>
  )
  const classes = screen.getByRole('button').classList
  expect(classes).toContain('md-comp-button-large')
  expect(classes).toContain('md-comp-outlined-button')
})

it('is a toggle when given selected, with tonal toggles on their own tokens', () => {
  const { rerender } = render(
    <Button variant="tonal" selected={false}>
      Shuffle
    </Button>
  )
  const button = screen.getByRole('button', { name: 'Shuffle' })
  expect(button.getAttribute('aria-pressed')).toBe('false')
  expect(button.classList).toContain('md-comp-tonal-button')
  rerender(
    <Button variant="tonal" selected>
      Shuffle
    </Button>
  )
  expect(button.getAttribute('aria-pressed')).toBe('true')
})

it('leaves aria-pressed off plain buttons', () => {
  render(<Button>Save</Button>)
  expect(screen.getByRole('button').hasAttribute('aria-pressed')).toBe(false)
})

it('draws a named icon, filled when selected, without naming the button after it', () => {
  render(
    <Button icon="favorite" selected>
      Favourite
    </Button>
  )
  const button = screen.getByRole('button', { name: 'Favourite' })
  const icon = button.querySelector('[translate="no"]')!
  expect(icon.textContent).toBe('favorite')
  expect(icon.getAttribute('aria-hidden')).toBe('true')
  expect(icon.className).toMatch(/filled/)
})

it('ripples from a press and fades when released', () => {
  render(<Button>Press</Button>)
  const button = screen.getByRole('button')
  fireEvent.pointerDown(button, { button: 0, clientX: 4, clientY: 4 })
  const ripples = () => button.querySelectorAll('[aria-hidden] > span')
  expect(ripples()).toHaveLength(1)
  fireEvent.pointerUp(window)
  expect(ripples()[0]!.className).toMatch(/released/)
})

it("doesn't ripple when disabled", () => {
  render(<Button disabled>Press</Button>)
  const button = screen.getByRole('button')
  fireEvent.pointerDown(button, { button: 0 })
  expect(button.querySelectorAll('[aria-hidden] > span')).toHaveLength(0)
})

it('labels the text field and reports errors accessibly', () => {
  render(<TextField label="Username" error="Required" />)
  const input = screen.getByLabelText('Username')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByRole('alert').textContent).toBe('Required')
  expect(input.getAttribute('aria-describedby')).toBe(
    screen.getByRole('alert').id
  )
})

it('opens a labelled modal dialog and closes it with Escape', () => {
  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Delete Films?"
        description="Files on disk are not touched."
        actions={<Button>Delete</Button>}
      />
    )
  }
  render(<Harness />)
  const dialog = screen.getByRole('dialog', { name: 'Delete Films?' })
  expect(dialog.getAttribute('aria-describedby')).toBe(
    screen.getByText('Files on disk are not touched.').id
  )
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('names an icon button by its label, not its icon', () => {
  render(<IconButton icon="skip_next" label="Next track" />)
  const button = screen.getByRole('button', { name: 'Next track' })
  expect(button.hasAttribute('aria-pressed')).toBe(false)
  expect(button.classList).toContain('md-comp-small-icon-button')
  expect(button.classList).toContain('md-comp-standard-icon-button')
})

it('makes a toggle icon button that fills its icon when selected', () => {
  render(
    <IconButton
      icon="favorite"
      label="Favourite"
      variant="tonal"
      size="l"
      width="wide"
      selected
    />
  )
  const button = screen.getByRole('button', { name: 'Favourite' })
  expect(button.getAttribute('aria-pressed')).toBe('true')
  expect(button.classList).toContain('md-comp-large-icon-button')
  expect(button.classList).toContain('md-comp-filled-tonal-icon-button')
  expect(button.querySelector('[translate="no"]')!.className).toMatch(/filled/)
})

it('names a FAB by its label and an extended FAB by its text', () => {
  render(
    <>
      <Fab icon="add" label="New playlist" size="large" color="secondary" />
      <ExtendedFab icon="edit" size="medium">
        Compose
      </ExtendedFab>
    </>
  )
  const fab = screen.getByRole('button', { name: 'New playlist' })
  expect(fab.classList).toContain('md-comp-fab-large')
  expect(fab.classList).toContain('md-comp-fab-secondary-container')
  const extended = screen.getByRole('button', { name: 'Compose' })
  expect(extended.classList).toContain('md-comp-extended-fab-medium')
  expect(extended.classList).toContain('md-comp-fab-primary-container')
})

it('renders its child as the icon button with asChild', () => {
  render(
    <IconButton asChild icon="play_arrow" label="Play Arrival">
      <a href="/play/arrival" />
    </IconButton>
  )
  const link = screen.getByRole('link', { name: 'Play Arrival' })
  expect(link.getAttribute('href')).toBe('/play/arrival')
  expect(link.querySelector('[translate="no"]')!.textContent).toBe('play_arrow')
})

it('groups buttons under a label', () => {
  render(
    <ConnectedButtonGroup label="View">
      <Button selected>Grid</Button>
      <Button selected={false}>List</Button>
    </ConnectedButtonGroup>
  )
  const group = screen.getByRole('group', { name: 'View' })
  expect(group.classList).toContain('md-comp-connected-button-group-small')
  expect(
    screen.getByRole('button', { name: 'Grid' }).getAttribute('aria-pressed')
  ).toBe('true')
})

describe('pressing an item in a button group', () => {
  // jsdom has no layout or Web Animations; give each item a width and
  // record what it would animate to.
  const targets = new Map<string, string>()
  beforeEach(() => {
    targets.clear()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 100
    } as DOMRect)
    HTMLElement.prototype.animate = vi.fn(function (
      this: HTMLElement,
      frames: Keyframe[]
    ) {
      targets.set(this.textContent!, String(frames.at(-1)!.width))
      return {
        cancel() {},
        finished: Promise.resolve()
      } as unknown as Animation
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate
  })

  function renderGroup() {
    render(
      <ButtonGroup>
        <Button>One</Button>
        <Button>Two</Button>
        <Button>Three</Button>
      </ButtonGroup>
    )
  }

  it('widens a middle item by 15% from both neighbours', () => {
    renderGroup()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Two' }), {
      button: 0
    })
    expect(Object.fromEntries(targets)).toEqual({
      One: '92.5px',
      Two: '115px',
      Three: '92.5px'
    })
    fireEvent.pointerUp(window)
  })

  it('widens an end item from its one neighbour', () => {
    renderGroup()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'One' }), {
      button: 0
    })
    expect(Object.fromEntries(targets)).toEqual({ One: '115px', Two: '85px' })
    fireEvent.pointerUp(window)
  })
})

it('splits an action from its menu button', () => {
  const { rerender } = render(
    <SplitButton icon="edit" menuLabel="More edit options" menuOpen={false}>
      Edit
    </SplitButton>
  )
  expect(
    screen.getByRole('button', { name: 'Edit' }).hasAttribute('aria-expanded')
  ).toBe(false)
  const menu = screen.getByRole('button', { name: 'More edit options' })
  expect(menu.getAttribute('aria-haspopup')).toBe('menu')
  expect(menu.getAttribute('aria-expanded')).toBe('false')
  rerender(
    <SplitButton icon="edit" menuLabel="More edit options" menuOpen>
      Edit
    </SplitButton>
  )
  expect(menu.getAttribute('aria-expanded')).toBe('true')
  expect(menu.closest('[role=group]')!.classList).toContain(
    'md-comp-split-button-small'
  )
})

it('makes a labelled native checkbox, indeterminate when asked', () => {
  const { rerender } = render(
    <label>
      <Checkbox defaultChecked /> Subtitles
    </label>
  )
  const box = screen.getByRole('checkbox', {
    name: 'Subtitles'
  }) as HTMLInputElement
  expect(box.checked).toBe(true)
  fireEvent.click(screen.getByText('Subtitles'))
  expect(box.checked).toBe(false)
  rerender(
    <label>
      <Checkbox indeterminate /> Subtitles
    </label>
  )
  expect(box.indeterminate).toBe(true)
})

it('makes native radios that share a name', () => {
  render(
    <fieldset>
      <label>
        <Radio name="quality" value="auto" defaultChecked /> Auto
      </label>
      <label>
        <Radio name="quality" value="original" /> Original
      </label>
    </fieldset>
  )
  const auto = screen.getByRole('radio', { name: 'Auto' }) as HTMLInputElement
  const original = screen.getByRole('radio', {
    name: 'Original'
  }) as HTMLInputElement
  fireEvent.click(original)
  expect(original.checked).toBe(true)
  expect(auto.checked).toBe(false)
})

it('makes a switch that works uncontrolled, with both icons ready', () => {
  render(<Switch aria-label="Shared" icons />)
  const toggle = screen.getByRole('switch', {
    name: 'Shared'
  }) as HTMLInputElement
  expect(toggle.checked).toBe(false)
  fireEvent.click(toggle)
  expect(toggle.checked).toBe(true)
  const icons = toggle.parentElement!.querySelectorAll('[translate="no"]')
  expect([...icons].map((i) => i.textContent)).toEqual(['check', 'close'])
})

it('makes assist and suggestion chips plain buttons', () => {
  render(
    <>
      <AssistChip icon="add" elevated>
        Add to playlist
      </AssistChip>
      <SuggestionChip>Arrival</SuggestionChip>
    </>
  )
  const assist = screen.getByRole('button', { name: 'Add to playlist' })
  expect(assist.hasAttribute('aria-pressed')).toBe(false)
  expect(assist.classList).toContain('md-comp-assist-chip')
  expect(screen.getByRole('button', { name: 'Arrival' }).classList).toContain(
    'md-comp-suggestion-chip'
  )
})

it('toggles a filter chip, showing a check when on', () => {
  const { rerender } = render(
    <FilterChip selected={false} icon="favorite">
      Favourites
    </FilterChip>
  )
  const chip = screen.getByRole('button', { name: 'Favourites' })
  const leading = () => chip.querySelector('[translate="no"]')!.textContent
  expect(chip.getAttribute('aria-pressed')).toBe('false')
  expect(leading()).toBe('favorite')
  rerender(
    <FilterChip selected icon="favorite" morph>
      Favourites
    </FilterChip>
  )
  expect(chip.getAttribute('aria-pressed')).toBe('true')
  expect(leading()).toBe('check')
  expect(chip.classList).toContain('md-comp-chips')
})

it('gives an input chip its own remove button', () => {
  const removed = vi.fn()
  render(<InputChip onRemove={removed}>Ana</InputChip>)
  expect(
    screen.getByRole('button', { name: 'Ana' }).hasAttribute('aria-pressed')
  ).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Remove Ana' }))
  expect(removed).toHaveBeenCalledOnce()
})

describe('Slider', () => {
  function Harness(props: { step?: number; initial?: number }) {
    const [v, setV] = useState(props.initial ?? 40)
    return (
      <Slider
        aria-label="Volume"
        value={v}
        onValueChange={setV}
        step={props.step}
        valueLabel={(n) => `${Math.round(n)}%`}
      />
    )
  }

  it('is a native range input with a spoken value', () => {
    render(<Harness />)
    const slider = screen.getByRole('slider', {
      name: 'Volume'
    }) as HTMLInputElement
    expect(slider.value).toBe('40')
    expect(slider.getAttribute('aria-valuetext')).toBe('40%')
    fireEvent.change(slider, { target: { value: '55' } })
    expect(slider.value).toBe('55')
    expect(slider.getAttribute('aria-valuetext')).toBe('55%')
  })

  it('draws a stop for each step, and the end stop without steps', () => {
    const { container, unmount } = render(<Harness step={25} />)
    // Five stops, drawn in both track segments.
    expect(container.querySelectorAll('[aria-hidden] span')).toHaveLength(10)
    unmount()
    const plain = render(<Harness />)
    expect(plain.container.querySelectorAll('[aria-hidden] span')).toHaveLength(
      1
    )
  })

  it('follows the pointer, snapping to the nearest step', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 200
    } as DOMRect)
    HTMLElement.prototype.setPointerCapture = vi.fn()
    render(<Harness step={25} initial={0} />)
    const slider = screen.getByRole('slider') as HTMLInputElement
    const root = slider.parentElement!
    fireEvent.pointerDown(root, { button: 0, clientX: 140, pointerId: 1 })
    expect(slider.value).toBe('75')
    fireEvent.pointerMove(root, { clientX: 20, pointerId: 1 })
    expect(slider.value).toBe('0')
    fireEvent.pointerUp(root, { pointerId: 1 })
    vi.restoreAllMocks()
  })
})

describe('TextField', () => {
  it('describes the field with its supporting text, which an error replaces', () => {
    const { rerender } = render(
      <TextField label="Name" supportingText="Shown on your profile" />
    )
    const input = screen.getByLabelText('Name')
    expect(
      document.getElementById(input.getAttribute('aria-describedby')!)!
        .textContent
    ).toBe('Shown on your profile')
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    rerender(
      <TextField
        label="Name"
        supportingText="Shown on your profile"
        error="Too long"
      />
    )
    expect(screen.getByRole('alert').textContent).toBe('Too long')
    expect(screen.queryByText('Shown on your profile')).toBeNull()
  })

  it('becomes a textarea when multiline', () => {
    render(<TextField label="Folders" multiline rows={3} variant="filled" />)
    const area = screen.getByLabelText('Folders')
    expect(area.tagName).toBe('TEXTAREA')
    expect(area.closest('.md-comp-filled-text-field')).not.toBeNull()
  })

  it('keeps an empty placeholder so it can tell when the label floats', () => {
    render(<TextField label="Search" leadingIcon="search" prefix="#" />)
    const input = screen.getByLabelText('Search') as HTMLInputElement
    expect(input.placeholder).toBe(' ')
    expect(screen.getByText('#')).toBeTruthy()
    const field = input.closest('.md-comp-outlined-text-field')!
    expect(field.querySelector('[translate="no"]')!.textContent).toBe('search')
  })
})

describe('menus', () => {
  // Radix uses browser APIs jsdom lacks.
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {}
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.releasePointerCapture = () => {}
  })

  it('opens a menu from its trigger and runs the chosen item', async () => {
    const renamed = vi.fn()
    render(
      <Menu trigger={<IconButton icon="more_vert" label="More" />}>
        <MenuItem icon="edit" onSelect={renamed}>
          Rename
        </MenuItem>
        <MenuItem icon="delete" disabled>
          Delete
        </MenuItem>
      </Menu>
    )
    const trigger = screen.getByRole('button', { name: 'More' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const item = await screen.findByRole('menuitem', { name: 'Rename' })
    expect(
      screen
        .getByRole('menuitem', { name: 'Delete' })
        .getAttribute('aria-disabled')
    ).toBe('true')
    fireEvent.click(item)
    expect(renamed).toHaveBeenCalledOnce()
  })

  it('makes a select a labelled combobox showing its value', async () => {
    const changed = vi.fn()
    render(
      <Select
        label="Kind"
        value="movies"
        onValueChange={changed}
        options={[
          { value: 'movies', label: 'Films' },
          { value: 'shows', label: 'Shows' }
        ]}
      />
    )
    const box = screen.getByRole('combobox', { name: 'Kind' })
    expect(box.textContent).toBe('Films')
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('option', { name: 'Shows' }))
    expect(changed).toHaveBeenCalledWith('shows')
  })
})

describe('List', () => {
  it('lists plain items with their text in order', () => {
    render(
      <List aria-label="Tracks" ordered>
        <ListItem
          leading={<span>1</span>}
          headline="Good News About Hell"
          trailingText="57 min"
        />
        <ListDivider />
        <ListItem headline="Half Loop" supporting="Season 1" />
      </List>
    )
    const list = screen.getByRole('list', { name: 'Tracks' })
    expect(list.tagName).toBe('OL')
    expect(
      screen
        .getAllByRole('listitem')
        .map((li) => li.textContent!.replace(/\s+/g, ' ').trim())
    ).toEqual(['1 Good News About Hell 57 min', 'Half Loop Season 1'])
    expect(screen.getByRole('separator')).toBeTruthy()
  })

  it('makes an item a button, marking the current one', () => {
    const pick = vi.fn()
    render(
      <List>
        <ListItem
          headline="Track one"
          onClick={pick}
          selected
          aria-current="true"
        />
      </List>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Track one' }))
    expect(pick).toHaveBeenCalledOnce()
    expect(screen.getByRole('listitem').getAttribute('aria-current')).toBe(
      'true'
    )
  })

  it('puts the content in a link with asChild, and trailing buttons beside it', () => {
    const play = vi.fn()
    render(
      <List>
        <ListItem
          asChild
          headline="Arrival"
          supporting="Film"
          trailing={
            <IconButton icon="play_arrow" label="Play Arrival" onClick={play} />
          }
        >
          <a href="/item/arrival" />
        </ListItem>
      </List>
    )
    const link = screen.getByRole('link', { name: 'Arrival Film' })
    expect(link.getAttribute('href')).toBe('/item/arrival')
    // The button is beside the link, not inside it.
    const button = screen.getByRole('button', { name: 'Play Arrival' })
    expect(link.contains(button)).toBe(false)
    fireEvent.click(button)
    expect(play).toHaveBeenCalledOnce()
  })
})

describe('Card', () => {
  it('is a plain container by default, filled', () => {
    render(
      <Card aria-label="Engine" role="region">
        <h2>Engine</h2>
      </Card>
    )
    const card = screen.getByRole('region', { name: 'Engine' })
    expect(card.tagName).toBe('DIV')
    expect(card.className).toContain('md-comp-filled-card')
    // No state layer on a card you can't press.
    expect(card.querySelector('[aria-hidden]')).toBeNull()
  })

  it('becomes a button with onClick, and can be disabled', () => {
    const open = vi.fn()
    const { rerender } = render(
      <Card variant="elevated" onClick={open}>
        Arrival
      </Card>
    )
    const card = screen.getByRole('button', { name: 'Arrival' })
    expect(card.className).toContain('md-comp-elevated-card')
    fireEvent.click(card)
    expect(open).toHaveBeenCalledOnce()
    rerender(
      <Card variant="elevated" onClick={open} disabled>
        Arrival
      </Card>
    )
    fireEvent.click(card)
    expect(open).toHaveBeenCalledOnce()
  })

  it('renders its child as the card with asChild', () => {
    render(
      <ul>
        <Card variant="outlined" asChild>
          <li>Films</li>
        </Card>
        <Card asChild>
          <a href="/library/films">Open Films</a>
        </Card>
      </ul>
    )
    const item = screen.getByRole('listitem')
    expect(item.className).toContain('md-comp-outlined-card')
    expect(item.textContent).toBe('Films')
    expect(screen.getByRole('link', { name: 'Open Films' })).toBeTruthy()
  })
})

describe('Dialog', () => {
  it('puts an icon above the title, then the body, then the actions', () => {
    render(
      <Dialog
        open
        onOpenChange={() => {}}
        icon="delete"
        title="Delete Films?"
        description="Files on disk are not touched."
        actions={
          <>
            <Button variant="text">Cancel</Button>
            <Button variant="text">Delete</Button>
          </>
        }
      >
        <TextField label="Type the name" />
      </Dialog>
    )
    const dialog = screen.getByRole('dialog', { name: 'Delete Films?' })
    const order = [
      dialog.querySelector('[translate="no"]'),
      screen.getByRole('heading', { name: 'Delete Films?' }),
      screen.getByText('Files on disk are not touched.'),
      screen.getByLabelText('Type the name'),
      screen.getByRole('button', { name: 'Cancel' }),
      screen.getByRole('button', { name: 'Delete' })
    ]
    for (let i = 1; i < order.length; i++)
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
  })
})

it('gives focus back to what opened a dialog when it closes', async () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Delete</Button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Delete Films?"
          actions={<Button onClick={() => setOpen(false)}>Cancel</Button>}
        />
      </>
    )
  }
  render(<Harness />)
  const opener = screen.getByRole('button', { name: 'Delete' })
  opener.focus()
  fireEvent.click(opener)
  expect(document.activeElement).not.toBe(opener)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(document.activeElement).toBe(opener))
})

describe('BottomSheet', () => {
  function Harness({ handle = true }: { handle?: boolean }) {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <BottomSheet
          open={open}
          onOpenChange={setOpen}
          title="Queue"
          dragHandle={handle}
        >
          <List aria-label="Tracks">
            <ListItem headline="Half Loop" />
          </List>
        </BottomSheet>
      </>
    )
  }

  it('opens a modal named by its title, which it doesn\u2019t show', () => {
    render(<Harness />)
    const sheet = screen.getByRole('dialog', { name: 'Queue' })
    expect(sheet.getAttribute('aria-describedby')).toBeNull()
    expect(screen.getByRole('list', { name: 'Tracks' })).toBeTruthy()
    // The rest of the page is hidden from screen readers while it's open.
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
  })

  it('closes from its handle and with Escape', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Close sheet' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('can leave the handle out', () => {
    render(<Harness handle={false} />)
    expect(screen.getByRole('dialog', { name: 'Queue' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Close sheet' })).toBeNull()
  })
})

describe('Snackbar', () => {
  it('shows a message with an action and a close button', () => {
    const undo = vi.fn()
    const close = vi.fn()
    render(
      <Snackbar
        message="Deleted Films"
        actionLabel="Undo"
        onAction={undo}
        onDismiss={close}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(undo).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('SnackbarHost', () => {
  const results: SnackbarResult[] = []
  let show: (o: SnackbarOptions) => Promise<SnackbarResult>
  function Grab() {
    show = useSnackbar()
    return null
  }
  function renderHost() {
    results.length = 0
    render(
      <SnackbarProvider>
        <Grab />
        <SnackbarHost />
      </SnackbarProvider>
    )
  }
  const queue = (o: SnackbarOptions) =>
    act(() => {
      void show(o).then((r) => results.push(r))
    })
  const status = () => screen.getByRole('status').textContent

  afterEach(() => vi.useRealTimers())

  it('shows one at a time, in order, and goes after 4 seconds', async () => {
    vi.useFakeTimers()
    renderHost()
    expect(status()).toBe('')
    queue({ message: 'Added to Rainy day' })
    queue({ message: 'Added to Road trip', duration: 'long' })
    expect(status()).toBe('Added to Rainy day')
    await act(() => vi.advanceTimersByTimeAsync(3999))
    expect(status()).toBe('Added to Rainy day')
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(status()).toBe('Added to Road trip')
    expect(results).toEqual(['dismissed'])
    await act(() => vi.advanceTimersByTimeAsync(9999))
    expect(status()).toBe('Added to Road trip')
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(status()).toBe('')
  })

  it('waits for its action, which says so', async () => {
    vi.useFakeTimers()
    renderHost()
    queue({ message: 'Deleted Films', actionLabel: 'Undo' })
    await act(() => vi.advanceTimersByTimeAsync(60000))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(results).toEqual(['action'])
    expect(status()).toBe('')
  })

  it('holds its time while hovered or focused', async () => {
    vi.useFakeTimers()
    renderHost()
    queue({ message: 'Access saved', withDismissAction: true })
    const close = screen.getByRole('button', { name: 'Dismiss' })
    fireEvent.focus(close)
    await act(() => vi.advanceTimersByTimeAsync(8000))
    expect(status()).toContain('Access saved')
    fireEvent.blur(close)
    await act(() => vi.advanceTimersByTimeAsync(4000))
    expect(status()).toBe('')
  })

  it('closes from its close button and with Escape', async () => {
    renderHost()
    queue({ message: 'One', withDismissAction: true })
    queue({ message: 'Two', withDismissAction: true })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(status()).toContain('Two')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Dismiss' }), {
      key: 'Escape'
    })
    expect(status()).toBe('')
    await waitFor(() => expect(results).toEqual(['dismissed', 'dismissed']))
  })
})

describe('Tooltip', () => {
  it('describes its child while it has keyboard focus', async () => {
    render(
      <Tooltip text="Queue">
        <IconButton icon="queue_music" label="Queue" />
      </Tooltip>
    )
    const button = screen.getByRole('button', { name: 'Queue' })
    fireEvent.focus(button)
    expect((await screen.findByRole('tooltip')).textContent).toBe('Queue')
    fireEvent.blur(button)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('opens a rich tooltip with an action when pressed, and closes from it', async () => {
    const more = vi.fn()
    render(
      <RichTooltip
        title="Hardware"
        text="Converting on the processor."
        action={
          <Button variant="text" onClick={more}>
            Learn more
          </Button>
        }
      >
        <IconButton icon="settings" label="About hardware" />
      </RichTooltip>
    )
    fireEvent.click(screen.getByRole('button', { name: 'About hardware' }))
    const tip = await screen.findByRole('dialog', { name: 'Hardware' })
    expect(tip.textContent).toContain('Converting on the processor.')
    fireEvent.click(screen.getByRole('button', { name: 'Learn more' }))
    expect(more).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('Tabs', () => {
  // The indicator follows sizes, which jsdom doesn't have.
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })

  it('switches panels, with arrow keys between tabs', async () => {
    render(
      <Tabs defaultValue="films">
        <TabList aria-label="Library">
          <Tab value="films" icon="play_arrow">
            Films
          </Tab>
          <Tab value="shows">Shows</Tab>
          <Tab value="music" disabled>
            Music
          </Tab>
        </TabList>
        <TabPanel value="films">All the films</TabPanel>
        <TabPanel value="shows">All the shows</TabPanel>
      </Tabs>
    )
    const list = screen.getByRole('tablist', { name: 'Library' })
    expect(list.querySelectorAll('[role=tab]')).toHaveLength(3)
    const films = screen.getByRole('tab', { name: 'Films' })
    expect(films.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toBe('All the films')
    films.focus()
    fireEvent.keyDown(films, { key: 'ArrowRight' })
    const shows = screen.getByRole('tab', { name: 'Shows' })
    await waitFor(() => expect(document.activeElement).toBe(shows))
    fireEvent.mouseDown(shows)
    await waitFor(() =>
      expect(screen.getByRole('tabpanel').textContent).toBe('All the shows')
    )
  })

  it('makes a nav of links, the current one marked', () => {
    render(
      <TabNav aria-label="Server settings" variant="secondary">
        <TabLink label="Libraries" selected>
          <a href="/admin" />
        </TabLink>
        <TabLink label="Users" selected={false}>
          <a href="/admin/users" />
        </TabLink>
      </TabNav>
    )
    const nav = screen.getByRole('navigation', { name: 'Server settings' })
    expect(nav.querySelectorAll('a')).toHaveLength(2)
    expect(
      screen
        .getByRole('link', { name: 'Libraries' })
        .getAttribute('aria-current')
    ).toBe('page')
    expect(
      screen.getByRole('link', { name: 'Users' }).getAttribute('aria-current')
    ).toBeNull()
  })
})

describe('TopAppBar', () => {
  it('lays out navigation, a title and actions in a banner', () => {
    render(
      <TopAppBar
        title="Weir"
        subtitle="Home"
        headingLevel={1}
        navigationIcon={<IconButton icon="arrow_back" label="Back" />}
        actions={<IconButton icon="search" label="Search" />}
      />
    )
    const bar = screen.getByRole('banner')
    expect(bar.className).toContain('md-comp-app-bar')
    expect(screen.getByRole('heading', { level: 1, name: 'Weir' })).toBeTruthy()
    expect(bar.querySelector('[data-title]')!.textContent).toBe('WeirHome')
    const [back, search] = screen.getAllByRole('button')
    expect(back!.getAttribute('aria-label')).toBe('Back')
    expect(search!.getAttribute('aria-label')).toBe('Search')
  })

  it('reads out only the showing title of a collapsing bar', () => {
    const page = document.createElement('div')
    document.body.append(page)
    render(
      <TopAppBar
        size="large"
        title="Films"
        headingLevel={1}
        scrollBehavior="exitUntilCollapsed"
        scrollTarget={page}
      />
    )
    expect(screen.getAllByRole('heading', { name: 'Films' })).toHaveLength(1)
    const bar = screen.getByRole('banner')
    // jsdom has no layout; give the bar its heights.
    Object.defineProperty(bar, 'offsetHeight', { value: 120 })
    Object.defineProperty(bar.firstElementChild, 'offsetHeight', {
      value: 64
    })
    Object.defineProperty(page, 'scrollTop', { value: 56, configurable: true })
    fireEvent.scroll(page)
    expect(bar.style.getPropertyValue('--_collapsed')).toBe('1')
    const [small, big] = bar.querySelectorAll('[data-title]')
    expect(small!.getAttribute('aria-hidden')).toBe('false')
    expect(big!.getAttribute('aria-hidden')).toBe('true')
    page.remove()
  })

  it('takes the on-scroll colour once content is under a pinned bar', () => {
    const page = document.createElement('div')
    document.body.append(page)
    render(
      <TopAppBar title="Weir" scrollBehavior="pinned" scrollTarget={page} />
    )
    const bar = screen.getByRole('banner')
    expect(bar.className).not.toContain('scrolled')
    Object.defineProperty(page, 'scrollTop', { value: 1, configurable: true })
    fireEvent.scroll(page)
    expect(bar.className).toContain('scrolled')
    page.remove()
  })
})

it('puts actions and a FAB in a bottom app bar', () => {
  render(
    <BottomAppBar
      aria-label="Actions"
      actions={<IconButton icon="search" label="Search" />}
      fab={<Fab icon="add" label="New playlist" />}
    />
  )
  expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'New playlist' })).toBeTruthy()
})

describe('Navigation', () => {
  it('makes a bar of links, the current one marked', () => {
    render(
      <NavigationBar aria-label="Main">
        <NavigationItem icon="search" label="Search" selected>
          <a href="/search" />
        </NavigationItem>
        <NavigationItem icon="favorite" label="Favourites" selected={false}>
          <a href="/favourites" />
        </NavigationItem>
      </NavigationBar>
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav.className).toContain('md-comp-navigation-bar')
    expect(
      screen.getByRole('link', { name: 'Search' }).getAttribute('aria-current')
    ).toBe('page')
    expect(
      screen
        .getByRole('link', { name: 'Favourites' })
        .getAttribute('aria-current')
    ).toBeNull()
  })

  it('puts labels inside the pill when the rail is expanded', () => {
    const pick = vi.fn()
    const { rerender } = render(
      <NavigationRail aria-label="Main" header={<button>Menu</button>}>
        <NavigationItem icon="settings" label="Settings" onClick={pick} />
      </NavigationRail>
    )
    const item = screen.getByRole('button', { name: /Settings/ })
    // Collapsed: the label under the pill.
    expect(item.lastElementChild!.textContent).toBe('Settings')
    fireEvent.click(item)
    expect(pick).toHaveBeenCalledOnce()
    rerender(
      <NavigationRail aria-label="Main" expanded>
        <NavigationItem icon="settings" label="Settings" selected />
      </NavigationRail>
    )
    const expanded = screen.getByRole('button', { name: /Settings/ })
    expect(expanded.children).toHaveLength(1)
    expect(expanded.getAttribute('aria-current')).toBe('true')
  })
})
