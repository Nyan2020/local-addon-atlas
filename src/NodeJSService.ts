import path from 'path';
import * as LocalMain from '@getflywheel/local/main';

const { execFilePromise, getServiceContainer } = LocalMain;

const serviceContainer = getServiceContainer();

export default class LightningServiceNodeJS extends LocalMain.LightningService {
	readonly serviceName:string = 'nodejs';

	readonly binVersion:string = '1.0.0';

	get requiredPorts() {
		return {
			NODEJS: 1,
		};
	}

	get appNodePath() : string {
		return path.join(this._site.longPath, 'app-node');
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

	get electronifiedPATH() : string {
		const PATH = process.env.PATH!.split(path.delimiter);

		/**
		 * Add node_modules/.bin to path.
		 */
		PATH.unshift(path.resolve(process.electronPaths.resourcesPath, 'npm-bundled', 'node_modules', '.bin'));
		PATH.unshift(path.join(process.electronPaths.resourcesPath, 'electron-node'));

		return PATH.join(path.delimiter);
	}

	get defaultEnv() : GenericObject {
		return {
			LOCAL_ELECTRON_PATH: this.bin!.electron,
			ELECTRON_RUN_AS_NODE: '1',
			PATH: this.electronifiedPATH,
		};
	}

	async preprovisionNext(): Promise<void> {
		await execFilePromise(this.bin!.electron, [
			path.resolve(process.electronPaths.resourcesPath, 'npm-bundled', 'node_modules', '.bin', 'npx'),
			'create-next-app',
			'--example',
			'cms-wordpress',
			'app-node',
		], {
			cwd: this._site.longPath,
			env: this.defaultEnv,
		});

		/**
		 * @todo Next.js doesn't support an env var for the start port. This is a termpoary hack around it.
		 *
		 * @see https://github.com/vercel/next.js/issues/10338
		 */
		await replaceInFileAsync(path.join(this._site.longPath, 'app-node', 'package.json'), [
			['"dev": "next",', '"dev": "next -p $PORT",'],
		]);
	}

	/**
	 * @todo show stdout/stderr to user
	 */
	async preprovision(): Promise<void> {
		switch (this._site.headlessFramework) {
			case 'next':
				return this.preprovisionNext();

			default:
				throw new Error('Unsupported Headless Framework.');
		}
	}

	async finalizeNewSite(): Promise<void> {
		const { wpCli, siteDatabase } = serviceContainer.cradle;

		// eslint-disable-next-line default-case
		switch (this._site.headlessFramework) {
			case 'next':
				await siteDatabase.waitForDB(this._site);

				await wpCli.run(this._site, [
					'plugin',
					'install',
					'https://github.com/wp-graphql/wp-graphql/archive/v0.13.2.zip',
					'--activate',
				]);

				await wpCli.run(this._site, [
					'plugin',
					'install',
					'https://github.com/wp-graphql/wp-graphiql/archive/v1.0.1.zip',
					'--activate',
				]);

				/**
				 * @todo The Next.js example throws errors if posts don't have a featured image. This is a temporary
				 *   workaround for demonstraton purposes.
				 */
				await wpCli.run(this._site, [
					'media',
					'import',
					'https://localwp.com/wp-content/themes/flywheel15/images/local-pro-ui.png',
				]);

				await wpCli.run(this._site, [
					'post',
					'meta',
					'update',
					'1',
					'_thumbnail_id',
					'4',
				]);
				break;
		}
	}

	get devEnvVars() : GenericObject {
		let env:GenericObject = {
			LOCAL_WP_HOST: `localhost:${this._site.wpPort}`,
		};

		switch (this._site.headlessFramework) {
			case 'next':
				env = {
					...env,
					PORT: this.port!.toString(),
					WORDPRESS_API_URL: `http://${env.LOCAL_WP_HOST}/graphql`,
				};
				break;

			default:
				throw new Error('Unsupported Headless Framework.');
		}

		return env;
	}

	start() {
		return [
			{
				name: 'nodejs',
				binPath: path.resolve(process.electronPaths.resourcesPath, 'npm-bundled', 'node_modules', '.bin', 'npm'),
				args: ['run', 'dev'],
				cwd: this.appNodePath,
				env: {
					...this.defaultEnv,
					...this.devEnvVars,
				},
			},
		];
	}
}
