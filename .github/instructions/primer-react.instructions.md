---
applyTo: "**/*.{ts,tsx}"
---

# Primer React Development Guidelines

Modern Primer React uses CSS-first patterns with design tokens. These guidelines ensure compatibility with the latest @primer/react patterns.

## Critical: No `sx` Prop

**Most Primer components no longer support the `sx` prop.** Use `className` with CSS utilities or inline styles with CSS custom properties instead.

```tsx
// ❌ WRONG - sx prop is deprecated on most components
<Button sx={{ marginTop: 2 }}>Click</Button>
<Text sx={{ color: 'fg.muted' }}>Text</Text>
<Stack gap={2}>Items</Stack>

// ✅ CORRECT - Use className or wrapper div with styles
<Button className="mt-2">Click</Button>
<span className="fgColor-muted">Text</span>
<Stack gap="normal">Items</Stack>
```

## Stack Component API

Stack uses string literals for layout values, NOT numbers:

```tsx
// Gap values (not numbers!)
gap: 'none' | 'condensed' | 'normal' | 'spacious'

// Align values (not flex-* values!)
align: 'stretch' | 'start' | 'center' | 'end' | 'baseline'

// Justify values
justify: 'start' | 'center' | 'end' | 'space-between' | 'space-evenly'

// Wrap values
wrap: 'wrap' | 'nowrap'

// Direction values  
direction: 'horizontal' | 'vertical'

// Padding values
padding: 'none' | 'condensed' | 'normal' | 'spacious'

// Example usage
<Stack direction="horizontal" gap="normal" align="center" justify="space-between">
  <Stack.Item grow>Content</Stack.Item>
  <Stack.Item>Sidebar</Stack.Item>
</Stack>
```

## Tooltip Component

Tooltip requires a `text` prop (not `aria-label`):

```tsx
// ❌ WRONG
<Tooltip aria-label="Help text">
  <IconButton icon={InfoIcon} />
</Tooltip>

// ✅ CORRECT  
<Tooltip text="Help text">
  <IconButton icon={InfoIcon} aria-label="Info" />
</Tooltip>

// For label-type tooltips
<Tooltip text="Settings" type="label">
  <IconButton icon={GearIcon} aria-label="Settings" />
</Tooltip>
```

## Banner Component

Banner is the modern replacement for Flash:

```tsx
// ❌ WRONG - Flash is deprecated
<Flash variant="warning">Message</Flash>

// ✅ CORRECT - Use Banner
<Banner
  title="Warning"
  description="Your session is about to expire."
  variant="warning"  // 'info' | 'warning' | 'critical' | 'success'
  onDismiss={() => setShow(false)}
  primaryAction={<Banner.PrimaryAction>Renew</Banner.PrimaryAction>}
  secondaryAction={<Banner.SecondaryAction>Dismiss</Banner.SecondaryAction>}
/>

// Hide title visually but keep for accessibility
<Banner title="Notice" hideTitle description="Content here" />
```

## Text and Heading

These components use semantic props, not sx:

```tsx
// ❌ WRONG
<Text sx={{ fontSize: 1, color: 'fg.muted' }}>Small muted</Text>
<Heading sx={{ fontSize: 3 }}>Title</Heading>

// ✅ CORRECT - Use className or wrapper elements
<span className="fgColor-muted f6">Small muted</span>
<Heading as="h2">Title</Heading>

// Future versions will support size/weight props
<Text size="small" weight="semibold">Styled text</Text>
```

## Box Component Alternative

Box is a helper component but modern patterns favor semantic HTML with classes:

```tsx
// Modern pattern - use div with CSS utilities/variables
<div 
  className="p-3 rounded-2"
  style={{
    backgroundColor: 'var(--bgColor-muted)',
    border: '1px solid var(--borderColor-default)',
    borderRadius: 'var(--borderRadius-medium)',
  }}
>
  Content
</div>
```

## Button Component

```tsx
// Variants
<Button variant="primary">Primary</Button>
<Button variant="default">Default</Button>
<Button variant="invisible">Invisible</Button>
<Button variant="danger">Danger</Button>

// Sizes
<Button size="small">Small</Button>
<Button size="medium">Medium (default)</Button>
<Button size="large">Large</Button>

// With icons
<Button leadingVisual={RocketIcon}>Launch</Button>
<Button trailingVisual={DownloadIcon}>Download</Button>
<Button trailingAction={TriangleDownIcon}>Dropdown</Button>

// States
<Button loading>Saving...</Button>
<Button inactive>Unavailable</Button>
<Button block>Full Width</Button>
```

## CSS Custom Properties (Design Tokens)

Use these CSS variables for consistent theming:

### Colors
```css
/* Foreground (text) */
--fgColor-default, --fgColor-muted, --fgColor-accent
--fgColor-success, --fgColor-attention, --fgColor-danger
--fgColor-open, --fgColor-closed, --fgColor-done

/* Background */
--bgColor-default, --bgColor-muted, --bgColor-inset
--bgColor-emphasis, --bgColor-accent-muted, --bgColor-accent-emphasis
--bgColor-success-muted, --bgColor-danger-muted

/* Border */
--borderColor-default, --borderColor-muted
--borderColor-accent-muted, --borderColor-accent-emphasis

/* Shadow */
--shadow-small, --shadow-medium, --shadow-large
```

### Sizing/Spacing
```css
--base-size-4, --base-size-8, --base-size-12, --base-size-16
--base-size-20, --base-size-24, --base-size-32, --base-size-40
```

### Border Radius
```css
--borderRadius-small, --borderRadius-medium, --borderRadius-large
```

## CSS Utility Classes

### Text Colors
```
fgColor-default, fgColor-muted, fgColor-accent
fgColor-success, fgColor-attention, fgColor-danger
```

### Background Colors
```
bgColor-default, bgColor-muted, bgColor-inset
bgColor-emphasis, bgColor-accent-muted
```

### Border Colors
```
borderColor-default, borderColor-muted
borderColor-accent-muted, borderColor-success-muted
```

## Layout Components

### PageLayout
For full page layouts with header, content, pane, and footer:

```tsx
<PageLayout>
  <PageLayout.Header divider="line">
    <HeaderContent />
  </PageLayout.Header>
  <PageLayout.Content>
    <MainContent />
  </PageLayout.Content>
  <PageLayout.Pane 
    position="end" 
    width="medium"
    sticky
    resizable
    divider="line"
  >
    <Sidebar />
  </PageLayout.Pane>
  <PageLayout.Footer>
    <FooterContent />
  </PageLayout.Footer>
</PageLayout>
```

### SplitPageLayout
For two-column layouts.

## Form Components

Always wrap inputs in FormControl for accessibility:

```tsx
<FormControl>
  <FormControl.Label>Username</FormControl.Label>
  <TextInput placeholder="Enter username" block />
  <FormControl.Caption>Your unique identifier</FormControl.Caption>
  <FormControl.Validation variant="error">
    Username is required
  </FormControl.Validation>
</FormControl>
```

## Action Components

### ActionMenu
```tsx
<ActionMenu>
  <ActionMenu.Button>Menu</ActionMenu.Button>
  <ActionMenu.Overlay>
    <ActionList>
      <ActionList.Item onSelect={() => {}}>
        <ActionList.LeadingVisual><GearIcon /></ActionList.LeadingVisual>
        Settings
      </ActionList.Item>
      <ActionList.Divider />
      <ActionList.Item variant="danger">Delete</ActionList.Item>
    </ActionList>
  </ActionMenu.Overlay>
</ActionMenu>
```

## Required Imports and Setup

```tsx
// Theme CSS (pick themes you need)
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'

// Components
import { ThemeProvider, BaseStyles } from '@primer/react'

// Root layout wrapper
function App() {
  return (
    <ThemeProvider colorMode="auto">
      <BaseStyles>
        <YourApp />
      </BaseStyles>
    </ThemeProvider>
  )
}
```

## Icons from @primer/octicons-react

Import icons individually for tree-shaking:

```tsx
import { 
  GearIcon, 
  RocketIcon, 
  CopilotIcon,
  CheckCircleIcon,
  AlertIcon,
  PersonIcon,
  // ... etc
} from '@primer/octicons-react'

// Use with size prop
<GearIcon size={16} />
<GearIcon size={24} />
<GearIcon size="small" />  // 16px
<GearIcon size="medium" /> // 24px
```

## Component Migration Quick Reference

| Old Pattern | New Pattern |
|-------------|-------------|
| `sx={{ color: 'fg.muted' }}` | `className="fgColor-muted"` |
| `sx={{ bg: 'canvas.subtle' }}` | `style={{ backgroundColor: 'var(--bgColor-muted)' }}` |
| `<Flash>` | `<Banner>` |
| `<Box>` | `<div>` with className |
| `gap={2}` on Stack | `gap="normal"` |
| `align="flex-start"` | `align="start"` |
| `Tooltip aria-label` | `Tooltip text` |
| `sx` on Button | `className` |

## Common Pitfalls

1. **Stack gap numbers**: Use `'normal'` not `{2}`
2. **Stack align values**: Use `'start'` not `'flex-start'`
3. **Tooltip missing text**: Always include `text` prop
4. **sx prop errors**: Most components don't support `sx` anymore
5. **Box import**: Box may not be exported from @primer/react
6. **Flash component**: Deprecated, use Banner instead

---

## Complete Component Reference

### Action Components

| Component | Purpose | Key Props | Example |
|-----------|---------|-----------|---------|
| **ActionBar** | Horizontal toolbar of IconButtons with overflow menu | `size: 'small' \| 'medium' \| 'large'`, `aria-label` | `<ActionBar><ActionBar.IconButton icon={BoldIcon} aria-label="Bold" /></ActionBar>` |
| **ActionList** | Vertical list of interactive items | `selectionVariant: 'single' \| 'multiple'`, `showDividers` | `<ActionList><ActionList.Item>Item</ActionList.Item></ActionList>` |
| **ActionMenu** | Dropdown menu with ActionList | Composed of `ActionMenu.Button`, `ActionMenu.Overlay` | See ActionMenu section below |

#### ActionList Sub-components
- `ActionList.Item` - Individual list item (`variant: 'default' \| 'danger'`, `disabled`, `loading`, `selected`)
- `ActionList.LinkItem` - Link item (renders as `<a>`)
- `ActionList.LeadingVisual` - Icon/avatar before text
- `ActionList.TrailingVisual` - Icon/text after content
- `ActionList.TrailingAction` - Interactive trailing element
- `ActionList.Description` - Description text (`variant: 'inline' \| 'block'`)
- `ActionList.Group` - Group container
- `ActionList.GroupHeading` - Group header (`as: 'h1' \| 'h2' \| 'h3'...`)
- `ActionList.Divider` - Visual separator

#### ActionMenu Example
```tsx
<ActionMenu>
  <ActionMenu.Button>Open menu</ActionMenu.Button>
  <ActionMenu.Overlay>
    <ActionList selectionVariant="single">
      <ActionList.Item selected={selected} onSelect={handleSelect}>
        <ActionList.LeadingVisual><GearIcon /></ActionList.LeadingVisual>
        Settings
        <ActionList.Description>Configure options</ActionList.Description>
      </ActionList.Item>
      <ActionList.Divider />
      <ActionList.Item variant="danger">Delete</ActionList.Item>
    </ActionList>
  </ActionMenu.Overlay>
</ActionMenu>
```

### Button Components

| Component | Purpose | Key Props | Example |
|-----------|---------|-----------|---------|
| **Button** | Primary action trigger | `variant: 'primary' \| 'default' \| 'invisible' \| 'danger'`, `size: 'small' \| 'medium' \| 'large'`, `leadingVisual`, `trailingVisual`, `trailingAction`, `loading`, `inactive`, `block` | `<Button variant="primary" leadingVisual={RocketIcon}>Launch</Button>` |
| **IconButton** | Icon-only button | `icon`, `aria-label` (required), `variant`, `size`, `loading`, `inactive`, `description`, `keybindingHint` | `<IconButton icon={GearIcon} aria-label="Settings" />` |
| **ButtonGroup** | Group of related buttons | Children are Buttons | `<ButtonGroup><Button>One</Button><Button>Two</Button></ButtonGroup>` |

### Form Components

| Component | Purpose | Key Props | Example |
|-----------|---------|-----------|---------|
| **FormControl** | Wrapper for form inputs with label/validation | `required`, `disabled` | See FormControl section |
| **TextInput** | Single-line text input | `block`, `size: 'small' \| 'medium' \| 'large'`, `leadingVisual`, `trailingVisual`, `trailingAction`, `loading`, `loaderPosition` | `<TextInput placeholder="Enter text" block />` |
| **Textarea** | Multi-line text input | `block`, `resize: 'none' \| 'horizontal' \| 'vertical' \| 'both'`, `rows` | `<Textarea rows={4} block />` |
| **TextInputWithTokens** | Input with token chips | `tokens`, `onTokenRemove`, `size` | `<TextInputWithTokens tokens={tokens} onTokenRemove={remove} />` |
| **Select** | Dropdown select | `block`, `size` | `<Select><Select.Option value="a">A</Select.Option></Select>` |
| **Checkbox** | Single checkbox | `value`, `checked`, `indeterminate`, `disabled` | `<Checkbox value="opt1" />` |
| **CheckboxGroup** | Group of checkboxes | `required`, `disabled` | See CheckboxGroup section |
| **Radio** | Single radio button | `value`, `name`, `checked`, `disabled` | `<Radio name="group" value="opt1" />` |
| **RadioGroup** | Group of radio buttons | `name`, `required`, `disabled` | See RadioGroup section |
| **ToggleSwitch** | On/off toggle | `checked`, `onChange`, `disabled`, `loading`, `size: 'small' \| 'medium'`, `statusLabelPosition` | `<ToggleSwitch aria-label="Feature" checked={on} onChange={setOn} />` |
| **Autocomplete** | Filterable dropdown | Composed of Input, Overlay, Menu | See Autocomplete section |
| **SelectPanel** | Multi-select with search | `title`, `onSubmit`, `onCancel` | Complex - see docs |

#### FormControl Pattern
```tsx
<FormControl required>
  <FormControl.Label>Email</FormControl.Label>
  <FormControl.Caption>Your work email address</FormControl.Caption>
  <TextInput type="email" block />
  <FormControl.Validation variant="error">Invalid email</FormControl.Validation>
</FormControl>
```

#### CheckboxGroup Pattern
```tsx
<CheckboxGroup>
  <CheckboxGroup.Label>Options</CheckboxGroup.Label>
  <CheckboxGroup.Caption>Select all that apply</CheckboxGroup.Caption>
  <FormControl>
    <Checkbox value="a" />
    <FormControl.Label>Option A</FormControl.Label>
  </FormControl>
  <FormControl>
    <Checkbox value="b" />
    <FormControl.Label>Option B</FormControl.Label>
  </FormControl>
  <CheckboxGroup.Validation variant="error">Required</CheckboxGroup.Validation>
</CheckboxGroup>
```

### Layout Components

| Component | Purpose | Key Props | Example |
|-----------|---------|-----------|---------|
| **Stack** | Flexbox layout | `direction: 'horizontal' \| 'vertical'`, `gap: 'none' \| 'condensed' \| 'normal' \| 'spacious'`, `align: 'stretch' \| 'start' \| 'center' \| 'end' \| 'baseline'`, `justify`, `wrap`, `padding` | `<Stack direction="horizontal" gap="normal">...</Stack>` |
| **PageLayout** | Full page structure | Composed of Header, Content, Pane, Footer | See PageLayout section |
| **SplitPageLayout** | Two-column layout | `Header`, `Content`, `Pane` | Similar to PageLayout |
| **PageHeader** | Page title area | `as` (heading level) | `<PageHeader><PageHeader.Title>Page</PageHeader.Title></PageHeader>` |

#### Stack.Item
```tsx
<Stack direction="horizontal">
  <Stack.Item grow>Fills remaining space</Stack.Item>
  <Stack.Item>Fixed width</Stack.Item>
</Stack>
```

#### PageLayout Pattern
```tsx
<PageLayout>
  <PageLayout.Header divider="line">Header</PageLayout.Header>
  <PageLayout.Content>
    Main content area
  </PageLayout.Content>
  <PageLayout.Pane 
    position="end" 
    width="medium" 
    sticky 
    resizable
    divider="line"
  >
    Sidebar
  </PageLayout.Pane>
  <PageLayout.Footer divider="line">Footer</PageLayout.Footer>
</PageLayout>
```

### Navigation Components

| Component | Purpose | Key Props | Example |
|-----------|---------|-----------|---------|
| **NavList** | Vertical navigation list | Similar to ActionList | `<NavList><NavList.Item href="/" aria-current="page">Home</NavList.Item></NavList>` |
| **Breadcrumbs** | Hierarchical navigation | - | `<Breadcrumbs><Breadcrumbs.Item href="/">Home</Breadcrumbs.Item></Breadcrumbs>` |
| **UnderlineNav** | Horizontal tab navigation | `aria-label` | `<UnderlineNav><UnderlineNav.Item href="/" aria-current="page">Tab 1</UnderlineNav.Item></UnderlineNav>` |
| **UnderlinePanels** | Tabbed content panels | - | `<UnderlinePanels><UnderlinePanels.Tab>Tab</UnderlinePanels.Tab><UnderlinePanels.Panel>Content</UnderlinePanels.Panel></UnderlinePanels>` |
| **Pagination** | Page navigation | `pageCount`, `currentPage`, `onPageChange` | `<Pagination pageCount={10} currentPage={1} onPageChange={setPage} />` |
| **TreeView** | Hierarchical tree | - | Complex nested structure |

#### NavList Pattern
```tsx
<NavList>
  <NavList.Item href="/" aria-current={isHome ? 'page' : undefined}>
    <NavList.LeadingVisual><HomeIcon /></NavList.LeadingVisual>
    Home
  </NavList.Item>
  <NavList.Group title="Section">
    <NavList.Item href="/settings">Settings</NavList.Item>
  </NavList.Group>
</NavList>
```

### Display Components

| Component | Purpose | Key Props | Example |
|-----------|---------|-----------|---------|
| **Avatar** | User/org image | `src`, `alt`, `size: 16 \| 20 \| 24 \| 28 \| 32 \| 40 \| 48 \| 64`, `square` | `<Avatar src={url} alt="Name" size={32} />` |
| **AvatarStack** | Stacked avatars | `size`, `alignRight`, `disableExpand` | `<AvatarStack><Avatar src={a} /><Avatar src={b} /></AvatarStack>` |
| **Label** | Metadata tag | `variant: 'default' \| 'primary' \| 'secondary' \| 'accent' \| 'success' \| 'attention' \| 'severe' \| 'danger' \| 'done' \| 'sponsors'`, `size: 'small' \| 'large'` | `<Label variant="success">Complete</Label>` |
| **LabelGroup** | Collection of labels | `visibleChildCount: number \| 'auto'` | `<LabelGroup><Label>A</Label><Label>B</Label></LabelGroup>` |
| **StateLabel** | Issue/PR status | `status: 'issueOpened' \| 'issueClosed' \| 'issueClosedNotPlanned' \| 'pullOpened' \| 'pullClosed' \| 'pullMerged' \| 'draft'`, `variant: 'small' \| 'normal'` | `<StateLabel status="pullMerged">Merged</StateLabel>` |
| **CounterLabel** | Numeric badge | `scheme: 'primary' \| 'secondary'` | `<CounterLabel>42</CounterLabel>` |
| **Token** | Removable tag | `text`, `onRemove`, `size`, `isSelected` | `<Token text="javascript" onRemove={handleRemove} />` |
| **BranchName** | Git branch display | `href` | `<BranchName href="#">main</BranchName>` |
| **RelativeTime** | Human-readable dates | `date`, `format` | `<RelativeTime date={new Date()} />` |
| **Truncate** | Ellipsis overflow | `title`, `inline`, `maxWidth` | `<Truncate title="Long text">Long text here</Truncate>` |

### Feedback Components

| Component | Purpose | Key Props | Example |
|-----------|---------|-----------|---------|
| **Banner** | Important notifications | `title`, `description`, `variant: 'info' \| 'warning' \| 'critical' \| 'success'`, `onDismiss`, `hideTitle`, `primaryAction`, `secondaryAction` | `<Banner title="Info" description="Message" variant="info" />` |
| **InlineMessage** | Contextual feedback | `variant: 'critical' \| 'warning' \| 'success' \| 'unavailable'`, `size: 'small' \| 'medium'` | `<InlineMessage variant="success">Saved!</InlineMessage>` |
| **Spinner** | Loading indicator | `size: 'small' \| 'medium' \| 'large'` | `<Spinner size="medium" />` |
| **ProgressBar** | Progress indicator | `progress`, `bg` | `<ProgressBar progress={75} />` |
| **Tooltip** | Hover information | `text` (required), `direction`, `type: 'label' \| 'description'` | `<Tooltip text="Help text"><Button>Hover</Button></Tooltip>` |
| **Popover** | Anchored callout | `open`, `caret: 'top' \| 'bottom' \| 'left' \| 'right' \| etc` | Complex positioning |

#### Banner with Actions
```tsx
<Banner
  title="Update available"
  description="A new version is ready to install."
  variant="info"
  onDismiss={() => setShow(false)}
  primaryAction={<Banner.PrimaryAction onClick={update}>Update now</Banner.PrimaryAction>}
  secondaryAction={<Banner.SecondaryAction onClick={dismiss}>Later</Banner.SecondaryAction>}
/>
```

### Dialog Components

| Component | Purpose | Key Props | Example |
|-----------|---------|-----------|---------|
| **Dialog** | Modal dialog | `title`, `subtitle`, `onClose`, `returnFocusRef`, `width: 'small' \| 'medium' \| 'large' \| 'xlarge'`, `height`, `position: 'center' \| 'left' \| 'right'`, `footerButtons` | See Dialog section |
| **ConfirmationDialog** | Confirm actions | `title`, `onClose`, `confirmButtonContent`, `cancelButtonContent`, `confirmButtonType: 'normal' \| 'danger'` | See ConfirmationDialog section |
| **Overlay** | Base floating surface | `returnFocusRef`, `onEscape`, `onClickOutside`, `width`, `height` | Low-level primitive |
| **AnchoredOverlay** | Positioned overlay | `open`, `onOpen`, `onClose`, `renderAnchor`, `side`, `align`, `anchorOffset` | See AnchoredOverlay section |

#### Dialog Pattern
```tsx
const buttonRef = useRef<HTMLButtonElement>(null)
const [isOpen, setIsOpen] = useState(false)

<Button ref={buttonRef} onClick={() => setIsOpen(true)}>Open</Button>
{isOpen && (
  <Dialog
    title="Dialog Title"
    subtitle="Optional subtitle"
    onClose={() => setIsOpen(false)}
    returnFocusRef={buttonRef}
    footerButtons={[
      {buttonType: 'default', content: 'Cancel', onClick: () => setIsOpen(false)},
      {buttonType: 'primary', content: 'Save', onClick: handleSave},
    ]}
  >
    Dialog content here
  </Dialog>
)}
```

#### ConfirmationDialog Pattern
```tsx
<Button variant="danger" onClick={() => setOpen(true)}>Delete</Button>
{open && (
  <ConfirmationDialog
    title="Delete item?"
    onClose={(gesture) => {
      setOpen(false)
      if (gesture === 'confirm') handleDelete()
    }}
    confirmButtonContent="Delete"
    confirmButtonType="danger"
    cancelButtonContent="Cancel"
  >
    This action cannot be undone.
  </ConfirmationDialog>
)}

// Or use the hook
const confirm = useConfirm()
const handleDelete = async () => {
  if (await confirm({title: 'Delete?', content: 'Cannot be undone.'})) {
    // proceed with deletion
  }
}
```

### Data Display Components

| Component | Purpose | Key Props | Example |
|-----------|---------|-----------|---------|
| **DataTable** | Data grid (experimental) | `data`, `columns`, `aria-labelledby` | See DataTable section |
| **Timeline** | Event timeline | - | `<Timeline><Timeline.Item>Event</Timeline.Item></Timeline>` |
| **Blankslate** | Empty state | `narrow`, `spacious`, `border` | See Blankslate section |
| **Details** | Collapsible content | Use with `useDetails` hook | See Details section |

#### DataTable Pattern
```tsx
import {Table, DataTable} from '@primer/react/experimental'

<Table.Container>
  <Table.Title as="h2" id="table-title">Items</Table.Title>
  <Table.Subtitle>Description of the data</Table.Subtitle>
  <DataTable
    aria-labelledby="table-title"
    data={rows}
    columns={[
      {header: 'Name', field: 'name', rowHeader: true, sortBy: 'alphanumeric'},
      {header: 'Status', field: 'status'},
      {header: 'Updated', field: 'updatedAt', renderCell: row => <RelativeTime date={row.updatedAt} />},
    ]}
  />
  <Table.Pagination
    pageSize={10}
    totalCount={100}
    currentPage={page}
    onPageChange={setPage}
  />
</Table.Container>
```

#### Blankslate Pattern
```tsx
<Blankslate spacious border>
  <Blankslate.Visual>
    <BookIcon size="medium" />
  </Blankslate.Visual>
  <Blankslate.Heading>No items yet</Blankslate.Heading>
  <Blankslate.Description>
    Get started by creating your first item.
  </Blankslate.Description>
  <Blankslate.PrimaryAction href="/new">Create item</Blankslate.PrimaryAction>
  <Blankslate.SecondaryAction href="/docs">Learn more</Blankslate.SecondaryAction>
</Blankslate>
```

### Loading Components

| Component | Purpose | Key Props | Example |
|-----------|---------|-----------|---------|
| **Spinner** | Indeterminate loader | `size: 'small' \| 'medium' \| 'large'` | `<Spinner />` |
| **SkeletonText** | Text placeholder | `size: 'display' \| 'titleLarge' \| 'titleMedium' \| 'titleSmall' \| 'subtitle' \| 'bodyLarge' \| 'bodyMedium' \| 'bodySmall'`, `lines`, `maxWidth` | `<SkeletonText size="bodyLarge" lines={3} />` |
| **SkeletonAvatar** | Avatar placeholder | `size`, `square` | `<SkeletonAvatar size={32} />` |
| **SkeletonBox** | Generic placeholder | `height`, `width` | `<SkeletonBox height="200px" />` |

### Selection Components

| Component | Purpose | Key Props | Example |
|-----------|---------|-----------|---------|
| **SegmentedControl** | Mutually exclusive options | `aria-label`, `fullWidth`, `size` | See SegmentedControl section |
| **SelectPanel** | Search + multi-select | `title`, `subtitle`, `onSubmit`, `onCancel` | Complex - see docs |

#### SegmentedControl Pattern
```tsx
<SegmentedControl aria-label="View mode" size="small">
  <SegmentedControl.Button selected={view === 'list'} onClick={() => setView('list')}>
    <SegmentedControl.IconLabel icon={ListUnorderedIcon} aria-label="List view" />
  </SegmentedControl.Button>
  <SegmentedControl.Button selected={view === 'grid'} onClick={() => setView('grid')}>
    <SegmentedControl.IconLabel icon={TableIcon} aria-label="Grid view" />
  </SegmentedControl.Button>
</SegmentedControl>

// Or with text labels
<SegmentedControl aria-label="File type">
  <SegmentedControl.Button selected>Preview</SegmentedControl.Button>
  <SegmentedControl.Button>Code</SegmentedControl.Button>
  <SegmentedControl.Button>Blame</SegmentedControl.Button>
</SegmentedControl>
```

### Typography Components

| Component | Purpose | Key Props | Example |
|-----------|---------|-----------|---------|
| **Heading** | Section headings | `as: 'h1' \| 'h2' \| 'h3' \| 'h4' \| 'h5' \| 'h6'` | `<Heading as="h2">Title</Heading>` |
| **Text** | Styled text spans | `size`, `weight`, `as` | `<Text size="small">Small text</Text>` |
| **Link** | Hyperlinks | `href`, `inline`, `muted`, `underline` | `<Link href="/page" inline>Click here</Link>` |

### Deprecated/Legacy Components

| Component | Replacement | Notes |
|-----------|-------------|-------|
| **Flash** | **Banner** | Flash is fully deprecated |
| **CircleBadge** | Custom styling | Use Octicons with custom styles |
| **Box** | `<div>` with CSS | Use semantic HTML with CSS utilities |

---

## Component Import Reference

```tsx
// Main components
import {
  ActionBar,
  ActionList,
  ActionMenu,
  AnchoredOverlay,
  Autocomplete,
  Avatar,
  AvatarStack,
  Banner,
  Blankslate,
  BranchName,
  Breadcrumbs,
  Button,
  ButtonGroup,
  Checkbox,
  CheckboxGroup,
  ConfirmationDialog,
  CounterLabel,
  Details,
  FormControl,
  Heading,
  IconButton,
  InlineMessage,
  Label,
  LabelGroup,
  Link,
  NavList,
  Overlay,
  PageHeader,
  PageLayout,
  Pagination,
  Popover,
  ProgressBar,
  Radio,
  RadioGroup,
  RelativeTime,
  SegmentedControl,
  Select,
  SelectPanel,
  Spinner,
  SplitPageLayout,
  Stack,
  StateLabel,
  Text,
  Textarea,
  TextInput,
  TextInputWithTokens,
  Timeline,
  ToggleSwitch,
  Token,
  Tooltip,
  TreeView,
  Truncate,
  UnderlineNav,
  UnderlinePanels,
  useConfirm,
  useDetails,
} from '@primer/react'

// Experimental components (may change)
import {
  DataTable,
  Dialog,
  Table,
  SkeletonAvatar,
  SkeletonBox,
  SkeletonText,
} from '@primer/react/experimental'

// Icons (import individually for tree-shaking)
import {
  AlertIcon,
  CheckCircleIcon,
  GearIcon,
  InfoIcon,
  PencilIcon,
  PersonIcon,
  RocketIcon,
  SearchIcon,
  XIcon,
  // ... see @primer/octicons-react for full list
} from '@primer/octicons-react'
```

---

## Accessibility Checklist

1. **All IconButtons must have `aria-label`** - Even if using Tooltip
2. **Form inputs need associated labels** - Use FormControl.Label
3. **ActionLists need `aria-label` or `aria-labelledby`** - For screen readers
4. **Dialogs need `returnFocusRef`** - Return focus to trigger on close
5. **Selection components need proper ARIA roles** - `role="menu"`, `aria-checked`, etc.
6. **Loading states should be announced** - Use `aria-live` regions
7. **Error messages should be associated** - FormControl.Validation handles this
8. **Interactive elements need visible focus** - Primer handles this by default
