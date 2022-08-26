import { App, Plugin, PluginSettingTab, Setting, requestUrl, RequestUrlParam, Notice } from 'obsidian';
import { StatusBar } from "./statusBar";
interface PerlegoPluginSettings {
	token: string;
}

const DEFAULT_SETTINGS: PerlegoPluginSettings = {
	token: ''
}

export default class PerlegoPlugin extends Plugin {
	settings: PerlegoPluginSettings;
	statusBar: StatusBar;

	async onload() {
		await this.loadSettings();

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		// const statusBarItemEl = this.addStatusBarItem();
		// statusBarItemEl.setText('Status Bar Text');

		// @ts-ignore
		if (!this.app.isMobile) {
			this.statusBar = new StatusBar(this.addStatusBarItem());
		}

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'import-perlego-notes-and-highlights',
			name: 'Import notes and highlights',
			callback: () => {
				new Perlego(this.app, this.settings.token, this.statusBar).importNotesAndHighlights()
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new PerlegoSettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class PerlegoSettingTab extends PluginSettingTab {
	plugin: PerlegoPlugin;

	constructor(app: App, plugin: PerlegoPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Perlego'});

		new Setting(containerEl)
			.setName('token')
			.setDesc('The secret token only developers know how to get')
			.addText(text => text
				.setValue(this.plugin.settings.token)
				.onChange(async (value) => {
					this.plugin.settings.token = value;

					await this.plugin.saveSettings();
				}));
	}
}

class Perlego {
	constructor(
        private readonly app: App,
        private readonly token: string,
		private readonly statusBar: StatusBar,
	) {
	}

	notice(msg: string, show = false, timeout = 0, forcing: boolean = false) {
		if (show) {
		  new Notice(msg);
		}
		
		// @ts-ignore
		if (!this.app.isMobile) {
		  this.statusBar.displayMessage(msg.toLowerCase(), timeout, forcing);
		} else {
		  if (!show) {
			new Notice(msg);
		  }
		}
	  }

	async importNotesAndHighlights() {
		this.notice('Importing notes and highlights...', false, 10)

		//
		// Fetch all the books a user has interacted with using /book-activity/books. This returns book ids.
		// 
		const booksRequest: RequestUrlParam = {
			url: 'https://api.perlego.com/book-activity/books',
			method: 'GET',
			headers: {
				'Authorization': 'Bearer ' + this.token,
			},
		}

		let response
		try {
			response = await requestUrl(booksRequest);
		} catch (error) {
			this.notice('Error downloading notes and highlights, is your token still valid?', true, 0, true)
			console.error(error)
			return
		}

		const books = response.json.data

		//
		// Loop over books
		//
		this.notice("Saving files...", false, 30, true);

		for (const key in books) {
			const book = books[key];
			const bookId = book.bookId

			//
			// Download notes and highlights using /ugc/v2/packaged-highlights
			//
			const notesAndHighlightsRequest: RequestUrlParam = {
				url: 'https://api.perlego.com/ugc/v2/packaged-highlights?book_id=' + bookId,
				method: 'GET',
				headers: {
					'Authorization': 'Bearer ' + this.token,
				},
			}

			const notesAndHighlights = await requestUrl(notesAndHighlightsRequest)
			if (notesAndHighlights.json.success === false || notesAndHighlights.json.data === null) {
				// @todo log error
				continue
			}

			const highlights = notesAndHighlights.json.data.results
				.map(result => '- ' + result.highlighted_text)
			const notes = notesAndHighlights.json.data.results
				.filter(result => result.notes.length > 0)
				.flatMap(result => result.notes.map(note => note.text))
				.filter(result => result.length > 0)
				.map(result => '- ' + result)

			// Grab the metadata for the book using /catalogue-service/v1/book
			const metadataRequest: RequestUrlParam = {
				url: 'https://api.perlego.com/catalogue-service/v1/book?book_id=' + bookId,
				method: 'GET',
				headers: {
					'Authorization': 'Bearer ' + this.token,
				},
			}

			const metadataResult = await requestUrl(metadataRequest)
			const metadata = metadataResult.json.data.results[0] 

			// Put notes and highlights in note
			const authors = metadata.contributors
				.filter(contributor => contributor.type === 'author')
				.map(contributor => contributor.name)
			let title = metadata.title.mainTitle
			if (metadata.title.subtitle !== "") {
				title += `; ${metadata.title.subtitle}`
			}

			let contents = `# ${metadata.title.mainTitle}\n\n` 
			contents += `![](${metadata.imageLinks.coverThumbnail})\n`
			contents += `## Metadata\n`
			contents += `- Author(s): ${authors.join(', ')}\n`
			contents += `- Full title: ${title}\n`
			contents += `## Highlights\n`
			contents += highlights.join("\n")
			contents += `\n## Notes\n`
			contents += notes.join("\n")

			// Create new note in folder with book name
			const fileName = 'Perlego/' + metadata.title.mainTitle + '.md'

			const exists = await this.app.vault.adapter.exists('Perlego');
			if (!exists) {
				await this.app.vault.adapter.mkdir('Perlego');
			}

			await this.app.vault.adapter.write(fileName, contents);
		}

		this.notice('Notes and highlights imported', false, 30, true)
	}
}