import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import {
  AssistChip,
  Button,
  ButtonGroup,
  Checkbox,
  ConnectedButtonGroup,
  Dialog,
  ExtendedFab,
  Fab,
  FilterChip,
  IconButton,
  InputChip,
  Radio,
  Slider,
  SplitButton,
  SuggestionChip,
  Switch,
  TextField
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
      >
        <Button>Delete</Button>
      </Dialog>
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
