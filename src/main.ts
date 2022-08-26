import { App, Plugin, PluginSettingTab, Setting, requestUrl, RequestUrlParam } from 'obsidian';
import heredoc from 'tsheredoc';

interface PerlegoPluginSettings {
	token: string;
}

const DEFAULT_SETTINGS: PerlegoPluginSettings = {
	token: ''
}

export default class PerlegoPlugin extends Plugin {
	settings: PerlegoPluginSettings;

	async onload() {
		await this.loadSettings();

		// Features:
		// 1. Settings page to enter token
		// 2. Command to import highlights and notes
		// 3. Auto import every x hours

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		// const statusBarItemEl = this.addStatusBarItem();
		// statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'import-perlego-notes-and-highlights',
			name: 'Import notes and highlights',
			callback: () => {
				new Perlego(this.app, this.settings.token).importNotesAndHighlights()
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new PerlegoSettingTab(this.app, this));

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
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
	) {
	}

	async importNotesAndHighlights() {
		console.log('importing!')

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
			console.error(error)
			return
		}

		const books = response.json.data

		//
		// Loop over books
		//
		books.forEach(async book => {
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
				return
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

			const metadata = await requestUrl(metadataRequest)

			// Put notes and highlights in note
			let contents = `# ${metadata.json.data.results[0].title.mainTitle}\n\n` 
			contents += `![](${metadata.json.data.results[0].imageLinks.coverThumbnail})\n`
			contents += `## Metadata\n`
			contents += `- Author(s): ${metadata.json.data.results[0].contributors[0].name}\n` // @todo map and join authors
			contents += `- Full title: ${metadata.json.data.results[0].title.mainTitle} ${metadata.json.data.results[0].title.subtitle}\n`
			contents += `## Highlights\n\n`
			contents += highlights.join("\n")
			contents += `\n## Notes\n`
			contents += notes.join("\n")

			// Create new note in folder with book name
			const fileName = 'Perlego/' + metadata.json.data.results[0].title.mainTitle + '.md'

			const exists = await this.app.vault.adapter.exists('Perlego');
			if (!exists) {
				await this.app.vault.adapter.mkdir('Perlego');
			}

			await this.app.vault.adapter.write(fileName, contents);
		})
	}
}