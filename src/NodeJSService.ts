import path from 'path';
import fs from 'fs-extra';
import * as LocalMain from '@getflywheel/local/main';
import { headlessDirectoryName } from './constants';

const { execFilePromise, getServiceContainer } = LocalMain;

const serviceContainer = getServiceContainer();

type GenericObject = { [key: string]: any };
const resourcesPath = path.resolve(__dirname, '..');
const nodeModulesPath = path.resolve(resourcesPath, 'node_modules');

export default class LightningServiceNodeJS extends LocalMain.LightningService {
	readonly serviceName: string = 'nodejs';

	readonly binVersion: string = '1.0.0';

	get requiredPorts() {
		return {
			HTTP: 1,
		};
	}

	get appNodePath(): string {
		return path.join(this._site.longPath, headlessDirectoryName);
	}

	get bins() {
		return {
			[LocalMain.LightningServicePlatform.Darwin]: {
				electron: process.execPath,
			},
			[LocalMain.LightningServicePlatform.Win32]: {
				electron: process.execPath,
			},
			[LocalMain.LightningServicePlatform.Linux]: {
				electron: process.execPath,
			},
		};
	}

	get electronifiedPATH(): string {
		const PATH = process.env.PATH!.split(path.delimiter);
		PATH.unshift(path.join(resourcesPath, 'electron-node'));
		return PATH.join(path.delimiter);
	}

	get defaultEnv(): GenericObject {
		return {
			LOCAL_ELECTRON_PATH: this.bin!.electron,
			ELECTRON_RUN_AS_NODE: '1',
			PATH: this.electronifiedPATH,
			NPM_PATH: path.join(nodeModulesPath, 'npm', 'bin', 'npm-cli.js'),
		};
	}

	/**
	 * @todo show stdout/stderr to user
	 */
	async preprovision(): Promise<void> {
		const appNodeExists = await fs.pathExists(path.resolve(this._site.longPath, headlessDirectoryName));

		if (appNodeExists) {
			// node_modules are excluded from exports so install them on import.
			await execFilePromise(this.bin!.electron, [
				path.resolve(nodeModulesPath, 'npm', 'bin', 'npm-cli.js'),
				'install',
			], {
				cwd: path.join(this._site.longPath, headlessDirectoryName),
				env: this.defaultEnv,
			});
		} else {
			await execFilePromise(this.bin!.electron, [
				path.resolve(nodeModulesPath, 'npx', 'index.js'),
				'create-next-app',
				'--example',
				'https://github.com/wpengine/headless-framework/tree/canary',
				'--example-path',
				'examples/getting-started',
				'--use-npm',
				headlessDirectoryName,
			], {
				cwd: this._site.longPath,
				env: this.defaultEnv,
			});
		}

		/**
		 * @todo Next.js doesn't support an env var for the start port. This is a termpoary hack around it.
		 *
		 * @see https://github.com/vercel/next.js/issues/10338
		 */
		await LocalMain.replaceInFileAsync(path.join(this.appNodePath, 'package.json'), [
			['"dev": "next dev",', '"dev": "next dev -p $PORT",'],
		]);
	}

	async finalizeNewSite(): Promise<void> {
		const { wpCli, siteDatabase, siteProcessManager } = serviceContainer.cradle;

		// eslint-disable-next-line default-case
		await siteDatabase.waitForDB(this._site);

		// Add GraphQL server to WordPress.
		await wpCli.run(this._site, [
			'plugin',
			'install',
			'https://github.com/wp-graphql/wp-graphql/archive/v1.1.5.zip',
			'--activate',
		]);

		// Add WP Engine Headless WordPress plugin.
		await wpCli.run(this._site, [
			'plugin',
			'install',
			'https://wp-product-info.wpesvc.net/v1/plugins/wpe-headless?download',
			'--activate',
		]);

		// Fetch the secret key generated by the headless plugin on activation.
		const headlessSettings = await wpCli.run(this._site, [
			'option',
			'get',
			'wpe_headless',
			'--format=json',
		]);
		const { secret_key: secretKey } = JSON.parse(headlessSettings);

		// Write the required settings for the headless framework to `.env.local`.
		const environmentFile = `WORDPRESS_URL=${this._site.backendUrl}
# Plugin secret found in WordPress Settings->Headless
WP_HEADLESS_SECRET=${secretKey}
`;
		await fs.writeFile(path.join(this.appNodePath, '.env.local'), environmentFile);

		// Next.js needs to be restarted after writing the env file.
		await siteProcessManager.restartSiteService(this._site, this.serviceName);
	}

	get devEnvVars(): GenericObject {
		return {
			PORT: this.port!.toString(),
			WORDPRESS_URL: this._site.backendUrl,
			WORDPRESS_API_URL: `${this._site.backendUrl}/graphql`,
		};
	}

	start() {
		return [
			{
				name: 'nodejs',
				binPath: path.resolve(this.appNodePath, 'node_modules', 'next', 'dist', 'bin', 'next'),
				args: ['dev', '-p', this.port!.toString()],
				cwd: this.appNodePath,
				env: {
					...this.defaultEnv,
					...this.devEnvVars,
				},
			},
		];
	}
}
