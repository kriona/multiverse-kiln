import '@github/markdown-toolbar-element';
import { defineMessages, type MessageDescriptor } from '@multiverse-kiln/shared';
import { Editor } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { StarterKit } from '@tiptap/starter-kit';

import { t } from '../localization';
import { readRemembered, remember } from '../rememberedValues';
import { reportFieldError } from './fieldErrors';
import { ALLOWED_LINK } from './markdown';
import { MarkdownLinkDialog } from './MarkdownLinkDialog';

/**
 * How a Markdown field shows its text: as rich text, formatted the way players see it, or as the
 * Markdown itself, with its formatting marks
 */
type MarkdownView = 'rich' | 'markdown';

/**
 * Where the browser keeps the view the player last chose, which every Markdown field starts in
 */
const VIEW_STORAGE_KEY = 'kiln-markdown-view';

/**
 * Text the Markdown fields show (see src/localization.ts)
 */
const markdownMessages = defineMessages({
	view: {
		id: 'markdown.view',
		defaultMessage: 'View',
		description: 'Name, for screen readers, of the pair of buttons above a Markdown field, such as a universe\'s long description, that choose between editing it as rich text and as Markdown'
	},
	richText: {
		id: 'markdown.richText',
		defaultMessage: 'Rich text',
		description: 'Button above a Markdown field, such as a universe\'s long description, that shows the text formatted the way players see it, and edits it that way'
	},
	markdown: {
		id: 'markdown.markdown',
		defaultMessage: 'Markdown',
		description: 'Button above a Markdown field, such as a universe\'s long description, that shows the text as written in Markdown, with its formatting marks, and edits it that way'
	},
	formatting: {
		id: 'markdown.formatting',
		defaultMessage: 'Formatting',
		description: 'Name, for screen readers, of the row of buttons above a Markdown field, such as a universe\'s long description, that format its text, such as Bold and Italic'
	},
	heading1: {
		id: 'markdown.heading1',
		defaultMessage: 'Heading 1',
		description: 'Name of the Markdown toolbar button that makes a heading of the first level'
	},
	heading1Button: {
		id: 'markdown.heading1Button',
		defaultMessage: 'H1',
		description: 'Short label of the Markdown toolbar button that makes a heading of the first level'
	},
	heading2: {
		id: 'markdown.heading2',
		defaultMessage: 'Heading 2',
		description: 'Name of the Markdown toolbar button that makes a heading of the second level'
	},
	heading2Button: {
		id: 'markdown.heading2Button',
		defaultMessage: 'H2',
		description: 'Short label of the Markdown toolbar button that makes a heading of the second level'
	},
	heading3: {
		id: 'markdown.heading3',
		defaultMessage: 'Heading 3',
		description: 'Name of the Markdown toolbar button that makes a heading of the third level'
	},
	heading3Button: {
		id: 'markdown.heading3Button',
		defaultMessage: 'H3',
		description: 'Short label of the Markdown toolbar button that makes a heading of the third level'
	},
	bold: {
		id: 'markdown.bold',
		defaultMessage: 'Bold',
		description: 'Name of the Markdown toolbar button that makes text bold'
	},
	boldButton: {
		id: 'markdown.boldButton',
		defaultMessage: 'B',
		description: 'One-letter label of the Markdown toolbar button that makes text bold, shown in bold'
	},
	italic: {
		id: 'markdown.italic',
		defaultMessage: 'Italic',
		description: 'Name of the Markdown toolbar button that makes text italic'
	},
	italicButton: {
		id: 'markdown.italicButton',
		defaultMessage: 'I',
		description: 'One-letter label of the Markdown toolbar button that makes text italic, shown in italics'
	},
	strikethrough: {
		id: 'markdown.strikethrough',
		defaultMessage: 'Strikethrough',
		description: 'Name of the Markdown toolbar button that strikes text through'
	},
	strikethroughButton: {
		id: 'markdown.strikethroughButton',
		defaultMessage: 'S',
		description: 'One-letter label of the Markdown toolbar button that strikes text through, shown struck through'
	},
	link: {
		id: 'markdown.link',
		defaultMessage: 'Link',
		description: 'Name of the Markdown toolbar button that adds a link'
	},
	linkButton: {
		id: 'markdown.linkButton',
		defaultMessage: 'Link',
		description: 'Short label of the Markdown toolbar button that adds a link'
	},
	quote: {
		id: 'markdown.quote',
		defaultMessage: 'Quote',
		description: 'Name of the Markdown toolbar button that makes text a quotation'
	},
	quoteButton: {
		id: 'markdown.quoteButton',
		defaultMessage: 'Quote',
		description: 'Short label of the Markdown toolbar button that makes text a quotation'
	},
	code: {
		id: 'markdown.code',
		defaultMessage: 'Code',
		description: 'Name of the Markdown toolbar button that formats text as code'
	},
	codeButton: {
		id: 'markdown.codeButton',
		defaultMessage: 'Code',
		description: 'Short label of the Markdown toolbar button that formats text as code'
	},
	bulletedList: {
		id: 'markdown.bulletedList',
		defaultMessage: 'Bulleted list',
		description: 'Name of the Markdown toolbar button that makes a bulleted list'
	},
	bulletedListButton: {
		id: 'markdown.bulletedListButton',
		defaultMessage: '• List',
		description: 'Short label of the Markdown toolbar button that makes a bulleted list'
	},
	numberedList: {
		id: 'markdown.numberedList',
		defaultMessage: 'Numbered list',
		description: 'Name of the Markdown toolbar button that makes a numbered list'
	},
	numberedListButton: {
		id: 'markdown.numberedListButton',
		defaultMessage: '1. List',
		description: 'Short label of the Markdown toolbar button that makes a numbered list'
	}
});

/**
 * One of the formatting buttons above a Markdown field
 */
interface FormatButton
{
	/**
	 * The markdown-toolbar style the button writes into the Markdown, e.g. bold
	 */
	style: string;

	/**
	 * The button's short label, and its full name for its tooltip and screen readers
	 */
	label: MessageDescriptor;
	name: MessageDescriptor;

	/**
	 * The element the label is shown in, so it looks like what the button does, e.g. strong for Bold
	 */
	look?: 'strong' | 'em' | 'del';

	/**
	 * Formats the rich text's selection, or undefined for Link, which asks for the address first
	 */
	format?: (editor: Editor) => void;

	/**
	 * Whether the rich text's selection has the format, for buttons that turn it on and off
	 */
	isActive?: (editor: Editor) => boolean;
}

/**
 * The formatting buttons, in the order they show
 */
const FORMAT_BUTTONS: readonly FormatButton[] = [
	...([1, 2, 3] as const).map((level): FormatButton => ({
		style: `header-${level}`,
		label: markdownMessages[`heading${level}Button`],
		name: markdownMessages[`heading${level}`],
		format: (editor) =>
		{
			editor.chain()
				.focus()
				.toggleHeading({ level })
				.run();
		},
		isActive: (editor) => editor.isActive('heading', { level })
	})),
	{
		style: 'bold',
		label: markdownMessages.boldButton,
		name: markdownMessages.bold,
		look: 'strong',
		format: (editor) =>
		{
			editor.chain()
				.focus()
				.toggleBold()
				.run();
		},
		isActive: (editor) => editor.isActive('bold')
	},
	{
		style: 'italic',
		label: markdownMessages.italicButton,
		name: markdownMessages.italic,
		look: 'em',
		format: (editor) =>
		{
			editor.chain()
				.focus()
				.toggleItalic()
				.run();
		},
		isActive: (editor) => editor.isActive('italic')
	},
	{
		style: 'strikethrough',
		label: markdownMessages.strikethroughButton,
		name: markdownMessages.strikethrough,
		look: 'del',
		format: (editor) =>
		{
			editor.chain()
				.focus()
				.toggleStrike()
				.run();
		},
		isActive: (editor) => editor.isActive('strike')
	},
	{
		style: 'link',
		label: markdownMessages.linkButton,
		name: markdownMessages.link
	},
	{
		style: 'quote',
		label: markdownMessages.quoteButton,
		name: markdownMessages.quote,
		format: (editor) =>
		{
			editor.chain()
				.focus()
				.toggleBlockquote()
				.run();
		},
		isActive: (editor) => editor.isActive('blockquote')
	},
	{
		style: 'code',
		label: markdownMessages.codeButton,
		name: markdownMessages.code,
		format: (editor) =>
		{
			const { $from, $to } = editor.state.selection;
			const chain = editor.chain().focus();

			// A selection across paragraphs becomes a code block, as markdown-toolbar does with lines
			if (editor.isActive('codeBlock') || !$from.sameParent($to))
			{
				chain.toggleCodeBlock().run();
			}
			else
			{
				chain.toggleCode().run();
			}
		},
		isActive: (editor) => (editor.isActive('code') || editor.isActive('codeBlock'))
	},
	{
		style: 'unordered-list',
		label: markdownMessages.bulletedListButton,
		name: markdownMessages.bulletedList,
		format: (editor) =>
		{
			editor.chain()
				.focus()
				.toggleBulletList()
				.run();
		},
		isActive: (editor) => editor.isActive('bulletList')
	},
	{
		style: 'ordered-list',
		label: markdownMessages.numberedListButton,
		name: markdownMessages.numberedList,
		format: (editor) =>
		{
			editor.chain()
				.focus()
				.toggleOrderedList()
				.run();
		},
		isActive: (editor) => editor.isActive('orderedList')
	}
];

/**
 * The formatting button each Ctrl (or Cmd) shortcut in the Markdown view presses, by key. The rich
 * text view has these keys itself
 */
const FORMAT_SHORTCUTS: Partial<Record<string, string>> = {
	b: 'bold',
	i: 'italic'
};

/**
 * A table whose Tab key stops at the last cell, so the key leaves the table rather than adding rows
 */
const TableWithTabOut = Table.extend({
	addKeyboardShortcuts()
	{
		return({
			...this.parent?.(),
			Tab: () => this.editor.commands.goToNextCell()
		});
	}
});

/**
 * The dialog that asks for a link's address, shared by every Markdown field on the page
 */
let linkDialog: MarkdownLinkDialog | undefined;

/**
 * A Markdown field, such as a universe's long description, that can be edited as rich text or as the
 * Markdown itself, with buttons above it to switch between them and to format the text
 *
 * The text area stays the field: forms read and track its value, and the rich text writes into it as
 * it changes. Rich text writes Markdown its own way (such as * for italics where _ was written), so the
 * text area keeps the Markdown as written until the rich text is changed, and gets it back if the
 * rich text is changed back to how it was
 */
export class MarkdownEditor
{
	private readonly bar = document.createElement('div');
	private readonly toolbar = document.createElement('markdown-toolbar');
	private readonly host = document.createElement('div');
	private readonly editor: Editor;

	/**
	 * The buttons that choose the view, by view
	 */
	private readonly viewButtons = new Map<MarkdownView, HTMLButtonElement>();

	/**
	 * The formatting buttons, with what each does
	 */
	private readonly formatButtons = new Map<HTMLButtonElement, FormatButton>();

	/**
	 * The view showing
	 */
	private view: MarkdownView = 'rich';

	/**
	 * Whether the field can be changed
	 */
	private editable = true;

	/**
	 * The Markdown the rich text was last filled from, with the document it made
	 */
	private loaded: { markdown: string; doc: ProseMirrorNode } | undefined;

	/**
	 * The field's text the rich text shows, or undefined before it shows any
	 */
	private shown: string | undefined;

	/**
	 * @param field The text area holding the Markdown, which needs an ID and a label
	 */
	constructor(private readonly field: HTMLTextAreaElement)
	{
		const label = field.labels?.[0];

		if (label && (label.id === ''))
		{
			label.id = `${field.id}-label`;
		}

		this.bar.className = 'markdown-bar';
		this.bar.append(this.createViewSwitch(), this.createToolbar());
		this.host.className = 'markdown-rich-host';
		this.host.style.setProperty('--markdown-rows', String(field.rows));
		field.before(this.bar);
		field.after(this.host);

		this.editor = new Editor({
			element: this.host,
			extensions: [
				StarterKit.configure({
					// Markdown has no underline, and an empty paragraph kept at the end would be written as blank lines
					underline: false,
					trailingNode: false,
					link: {
						openOnClick: false,
						defaultProtocol: 'https',
						isAllowedUri: (url) => ALLOWED_LINK.test(url),
						HTMLAttributes: {
							rel: 'noopener noreferrer nofollow',
							target: '_blank'
						}
					}
				}),
				TableWithTabOut.configure({ resizable: false }),
				TableRow,
				TableHeader,
				TableCell,
				Markdown
			],
			editorProps: {
				attributes: () => ({
					class: 'markdown markdown-rich',
					'aria-multiline': 'true',
					'aria-readonly': String(!this.editable),
					...(label ? { 'aria-labelledby': label.id } : {})
				})
			}
		});

		this.editor.on('update', () =>
		{
			this.richChanged();
		});

		this.editor.on('transaction', () =>
		{
			this.showActiveFormats();
		});

		// The label points at the text area, which is hidden while the rich text shows
		label?.addEventListener('click', (event) =>
		{
			if (this.view === 'rich')
			{
				event.preventDefault();
				this.editor.commands.focus();
			}
		});

		field.addEventListener('keydown', (event) =>
		{
			this.applyShortcut(event);
		});

		this.refresh();
	}

	/**
	 * Shows the field as it is now, after code changes its text or whether it can be changed. A field
	 * that can't be changed shows as rich text without the buttons, the way players see it
	 */
	refresh(): void
	{
		this.editable = !(this.field.matches(':disabled') || this.field.readOnly);
		this.editor.setEditable(this.editable, false);
		this.bar.hidden = !this.editable;
		this.showView((this.editable ? preferredView() : 'rich'));
	}

	/**
	 * Gives the field focus, in the view showing
	 */
	focus(): void
	{
		if (this.view === 'rich')
		{
			this.editor.commands.focus();
		}
		else
		{
			this.field.focus();
		}
	}

	/**
	 * Shows what is wrong with the field's text under it, in the Markdown view, where every character
	 * of the text can be seen
	 *
	 * @param message What is wrong, in the player's language
	 */
	reportError(message: string): void
	{
		if (this.editable)
		{
			this.showView('markdown');
		}

		reportFieldError(this.field, message);
	}

	/**
	 * The buttons that choose between the rich text and Markdown views
	 *
	 * @return The group of buttons
	 */
	private createViewSwitch(): HTMLElement
	{
		const group = document.createElement('div');

		group.className = 'markdown-view-switch';
		group.setAttribute('role', 'group');
		group.setAttribute('aria-label', t(markdownMessages.view));

		for (const [view, message] of [['rich', markdownMessages.richText], ['markdown', markdownMessages.markdown]] as const)
		{
			const button = document.createElement('button');

			button.type = 'button';
			button.textContent = t(message);
			button.addEventListener('click', () =>
			{
				remember(VIEW_STORAGE_KEY, view);
				this.showView(view);
			});
			this.viewButtons.set(view, button);
			group.append(button);
		}

		return(group);
	}

	/**
	 * The formatting buttons. In the Markdown view markdown-toolbar writes their formatting into the
	 * text area; in the rich text view they format the rich text instead
	 *
	 * @return The toolbar
	 */
	private createToolbar(): HTMLElement
	{
		const toolbar = this.toolbar;

		toolbar.className = 'markdown-toolbar';
		toolbar.setAttribute('for', this.field.id);
		toolbar.setAttribute('aria-label', t(markdownMessages.formatting));

		for (const format of FORMAT_BUTTONS)
		{
			const button = document.createElement('button');
			const name = t(format.name);
			const label = t(format.label);

			button.type = 'button';
			button.dataset.mdButton = format.style;
			button.title = name;
			button.setAttribute('aria-label', name);

			if (format.look)
			{
				const look = document.createElement(format.look);

				look.textContent = label;
				button.append(look);
			}
			else
			{
				button.textContent = label;
			}

			if (format.style === 'link')
			{
				button.setAttribute('aria-haspopup', 'dialog');
			}

			this.formatButtons.set(button, format);
			toolbar.append(button);
		}

		// These listen as the event comes down to the button, before markdown-toolbar's own listeners on
		// the toolbar, so in the rich text view they can stop it changing the hidden text area
		toolbar.addEventListener('click', (event) =>
		{
			if (this.view !== 'rich')
			{
				return;
			}

			event.stopPropagation();

			const button = ((event.target instanceof Element) ? event.target.closest('button') : null);
			const format = (button ? this.formatButtons.get(button) : undefined);

			if (format)
			{
				event.preventDefault();
				this.formatRich(format);
			}
		}, { capture: true });

		// markdown-toolbar formats on Enter and Space itself; in the rich text view the button's own
		// click does instead
		toolbar.addEventListener('keydown', (event) =>
		{
			if ((this.view === 'rich') && ((event.key === 'Enter') || (event.key === ' ')))
			{
				event.stopPropagation();
			}
		}, { capture: true });

		return(toolbar);
	}

	/**
	 * Shows the field in a view
	 *
	 * @param view The view
	 */
	private showView(view: MarkdownView): void
	{
		const hadFocus = (this.field.matches(':focus') || this.editor.isFocused);

		this.view = view;

		if (view === 'rich')
		{
			this.fillRich();
		}

		this.field.hidden = (view === 'rich');
		this.host.hidden = (view !== 'rich');

		for (const [buttonView, button] of this.viewButtons)
		{
			button.setAttribute('aria-pressed', String(buttonView === view));
		}

		this.showActiveFormats();

		if (hadFocus)
		{
			this.focus();
		}
	}

	/**
	 * Fills the rich text from the text area, unless it shows the text area's text already
	 */
	private fillRich(): void
	{
		const markdown = this.field.value;

		if (markdown === this.shown)
		{
			return;
		}

		// Filling the rich text isn't an edit, so undo doesn't go back past it
		this.editor.chain()
			.setMeta('addToHistory', false)
			.setContent(markdown, {
				contentType: 'markdown',
				emitUpdate: false
			})
			.run();
		this.loaded = {
			markdown,
			doc: this.editor.state.doc
		};
		this.shown = markdown;
	}

	/**
	 * Writes the rich text into the text area as it changes, and tells the form. Rich text changed back
	 * to how it was filled gives the text area back the Markdown as written
	 */
	private richChanged(): void
	{
		const loaded = this.loaded;

		this.field.value = ((loaded && this.editor.state.doc.eq(loaded.doc)) ? loaded.markdown : this.editor.getMarkdown());
		this.shown = this.field.value;
		this.field.dispatchEvent(new Event('input', { bubbles: true }));
	}

	/**
	 * Marks the formatting buttons that turn a format on and off as pressed while the rich text's
	 * selection has it. In the Markdown view they only add formatting, so they show no state
	 */
	private showActiveFormats(): void
	{
		for (const [button, format] of this.formatButtons)
		{
			if ((this.view === 'rich') && format.isActive)
			{
				button.setAttribute('aria-pressed', String(format.isActive(this.editor)));
			}
			else
			{
				button.removeAttribute('aria-pressed');
			}
		}
	}

	/**
	 * Formats the rich text's selection the way a formatting button does
	 *
	 * @param format The button
	 */
	private formatRich(format: FormatButton): void
	{
		if (format.format)
		{
			format.format(this.editor);
		}
		else
		{
			this.editLink();
		}
	}

	/**
	 * Asks for the address of the link at the rich text's selection, then links the selection to it, or
	 * removes the link. With nothing selected, the address is added as a link
	 */
	private editLink(): void
	{
		const href = this.editor.getAttributes('link').href as string | undefined;

		linkDialog ??= new MarkdownLinkDialog();
		linkDialog.open(href, (address) =>
		{
			const chain = this.editor.chain()
				.focus()
				.extendMarkRange('link');

			if (address === null)
			{
				chain.unsetLink().run();
			}
			else if (this.editor.state.selection.empty && !this.editor.isActive('link'))
			{
				chain.insertContent({
					type: 'text',
					text: address,
					marks: [{ type: 'link', attrs: { href: address } }]
				}).run();
			}
			else
			{
				chain.setLink({ href: address }).run();
			}
		});
	}

	/**
	 * Formats the text area's selection when a key press is one of the formatting shortcuts
	 *
	 * @param event The key press in the text area
	 */
	private applyShortcut(event: KeyboardEvent): void
	{
		if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey)
		{
			return;
		}

		const style = FORMAT_SHORTCUTS[event.key.toLowerCase()];
		const button = (style ? this.toolbar.querySelector<HTMLButtonElement>(`[data-md-button="${style}"]`) : null);

		if (button)
		{
			event.preventDefault();
			button.click();
		}
	}
}

/**
 * The view the player last chose, which Markdown fields start in
 *
 * @return The view, rich text unless the player chose Markdown
 */
function preferredView(): MarkdownView
{
	return(((readRemembered(VIEW_STORAGE_KEY) === 'markdown') ? 'markdown' : 'rich'));
}
