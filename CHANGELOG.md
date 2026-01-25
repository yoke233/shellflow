# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0](https://github.com/shkm/shellflow/compare/v0.7.0...v0.8.0) (2026-01-25)


### Features

* add context-aware keybindings system (Phase 1 & 2) ([c5f9f55](https://github.com/shkm/shellflow/commit/c5f9f55ab9a106631e07d1ad0add1251637f5503))
* add key lookup for UI display and fix terminal copy/paste ([658f6b2](https://github.com/shkm/shellflow/commit/658f6b2801ae970cd47ef66a1247a310e8405015))
* add Rust backend for mappings (Phase 2b) ([3d2f38e](https://github.com/shkm/shellflow/commit/3d2f38ebd408712e882ca504f8638aacf6037182))
* integrate context-aware keybindings (Phase 3) ([f69d4d2](https://github.com/shkm/shellflow/commit/f69d4d29cedb0402c8b8e6d9ac02d4cd7b48045a))


### Bug Fixes

* closed projects now appear in sidebar when selected from switcher ([938f453](https://github.com/shkm/shellflow/commit/938f4530ac9f3104bd16ab2b3b040573452ffafa))


### Performance Improvements

* only watch worktrees for active projects at startup ([f5858f4](https://github.com/shkm/shellflow/commit/f5858f465e8b9a895d6eaa36fa170283a88d90ae))

## [0.7.0](https://github.com/shkm/shellflow/compare/v0.6.0...v0.7.0) (2026-01-24)


### Features

* add active/closed project management with project switcher ([42b3072](https://github.com/shkm/shellflow/commit/42b3072ef22bc1140549c900ae954be0e1d6c8b1))
* add Cmd+Enter shortcut for merge/rebase completion banner ([fc104ad](https://github.com/shkm/shellflow/commit/fc104ad457bc65064d49900d6ce26ea96f287fa7))
* add command palette ([1855412](https://github.com/shkm/shellflow/commit/18554120a76223568b6fe9572707a9f6fb753446))
* add crash recovery with watchdog process ([ffd937d](https://github.com/shkm/shellflow/commit/ffd937d33387eb3659fd6d47b777ecac3899e8cf))
* add error toast notifications for worktree creation failures ([9b1f355](https://github.com/shkm/shellflow/commit/9b1f355a770a060871a850535bcf55b71f652349))
* add file drag-and-drop support for terminals ([10bae34](https://github.com/shkm/shellflow/commit/10bae347b2820a740f093ce2c9061ed19fe27453))
* add focusNewBranchNames worktree config option ([f6eee1b](https://github.com/shkm/shellflow/commit/f6eee1b9b6ba0ef8a2461fc40ec8bbd112cd18f8))
* add focusNewBranchNames worktree config option ([4383779](https://github.com/shkm/shellflow/commit/43837790eb903bd05d91be85d1b8a955dd7d8fd4))
* add keyboard shortcuts for drawer tabs and branch renaming ([a27fe96](https://github.com/shkm/shellflow/commit/a27fe963db8d6fcd0e955ebfacd561e8aa7b2d28))
* add new scratch terminal action with dedicated shortcut ([1b4efb8](https://github.com/shkm/shellflow/commit/1b4efb8ba8647f236c80b23fa69b0ac3e5c72b5a))
* add unfocusedOpacity setting for dimming inactive panes ([10f55fd](https://github.com/shkm/shellflow/commit/10f55fd25cc4eb0f9d4e809e67d80ae39429f627))
* improve close project workflow ([b03cafc](https://github.com/shkm/shellflow/commit/b03cafc12c72fd5d720e6d65098083c660a99977))


### Bug Fixes

* block global shortcuts when picker is open ([3579016](https://github.com/shkm/shellflow/commit/35790164cf6d578cb4a77641eb14eceb43927b03))
* clear activeProjectId when switching to scratch terminal ([0a5106b](https://github.com/shkm/shellflow/commit/0a5106ba82a916f153dc08331349c33d0dff8d74))
* focus main terminal after editing new worktree branch name ([2132eed](https://github.com/shkm/shellflow/commit/2132eed4f95c36afc7dd3cb5c1139b4b13be87ef))
* make title changes bypass grace period for faster progress indicator ([1e7725f](https://github.com/shkm/shellflow/commit/1e7725f5f488b9224aacde41f42e397bae9c0878))
* newly added projects not appearing in sidebar ([04841e8](https://github.com/shkm/shellflow/commit/04841e8a6d9d650b163f75929fcf6e2c8838a6db))
* prevent double paste in terminal ([6735c61](https://github.com/shkm/shellflow/commit/6735c61f5010f2ec515830679b89db0ea8ae8e35))
* reduce delay showing progress indicator after switching tabs ([1561895](https://github.com/shkm/shellflow/commit/156189518b45c9ce75116f7ba6f29626e5181992))

## [0.6.0](https://github.com/shkm/shellflow/compare/v0.5.0...v0.6.0) (2026-01-23)


### Features

* add buttons to open worktree in terminal/editor ([7b4e7f1](https://github.com/shkm/shellflow/commit/7b4e7f192e5713cb04d6321d0e0fb53246a62b75))
* add clickable folder path display with context menu ([bffcafb](https://github.com/shkm/shellflow/commit/bffcafb8583e94e064b97f5b4f4e0a4004fea6d0))
* add configurable terminal padding ([10412ce](https://github.com/shkm/shellflow/commit/10412ce490bd2df25fa39b392b6fa288b20bae33))
* add environment variable support to task configuration ([f22b2c2](https://github.com/shkm/shellflow/commit/f22b2c2bcfbbfe78309605571a07431825fe1f6a))
* add menu bar with centralized action system ([af86498](https://github.com/shkm/shellflow/commit/af8649833b2f576acc2f034757061996753f5d9b))
* add open in terminal/editor to menu bar ([0181cf8](https://github.com/shkm/shellflow/commit/0181cf83bd1eeeb39eddbfd5630d34842a14fdb8))
* add scratch terminals for general-purpose shell access ([8613f4b](https://github.com/shkm/shellflow/commit/8613f4bf26e798e1a363a5b890e8c37c0b1e469c))
* add shell_escape template filter ([2f83817](https://github.com/shkm/shellflow/commit/2f83817bdec8aac135e97efbda9bf4dc91696f63))
* auto-reload config and show parse errors ([620959f](https://github.com/shkm/shellflow/commit/620959f0db9782e31f0168a429cfb466b5f7a6e7))
* implement includeProjects navigation config ([c55a5af](https://github.com/shkm/shellflow/commit/c55a5af05c081a21f3e93b996b00dbccae828f33))
* include projects in keyboard navigation ([0aeb540](https://github.com/shkm/shellflow/commit/0aeb540e3bdaf7ec82ed76d98d3513831e4839b2))
* unify process exit UI across worktree and project views ([2347ebd](https://github.com/shkm/shellflow/commit/2347ebdf077fb4388529f25d86da5feaf8149747))


### Bug Fixes

* add missing keyboard mappings to config schema ([cf51559](https://github.com/shkm/shellflow/commit/cf51559f7dc6f62f070abd9fdd1a0199e8b54db7))
* correct TaskTerminal container sizing for scrollbar ([3637fe9](https://github.com/shkm/shellflow/commit/3637fe9dbd93e860e700f205e6ae7a5ed53ec684))
* dispatch resize event on zoom level change ([c9246b4](https://github.com/shkm/shellflow/commit/c9246b46243ebdc7bc135ef641ebfccf32d1ee13))
* drawer terminals in projects now spawn shell instead of main command ([9651341](https://github.com/shkm/shellflow/commit/9651341a60daabf92a7772b35a985ddff42ef257))
* enable drawer terminal for scratch terminals ([207f7ea](https://github.com/shkm/shellflow/commit/207f7ea7a675284cf16f34d88453434d3833b2ef))
* limit task search to name only ([a812380](https://github.com/shkm/shellflow/commit/a8123808928fba2b88234c7657435ee949a2a908))
* prevent add project dialog from reopening on escape ([ed27687](https://github.com/shkm/shellflow/commit/ed276879bd53b7e70f40924e08d1abfd01295f30))
* recover WebGL renderer after context loss to prevent terminal blur ([be0f75a](https://github.com/shkm/shellflow/commit/be0f75a5e97fe1eb2773197f173a204215509cee))
* shift+esc does not send esc to terminal ([d61cb35](https://github.com/shkm/shellflow/commit/d61cb35c23c5590d2eb09d8e399d50efc2824a14))
* task terminal not scrolling ([abaf1e1](https://github.com/shkm/shellflow/commit/abaf1e16631001584eef85423e69a8fafbd187ee))

## [0.5.0](https://github.com/shkm/shellflow/compare/v0.4.0...v0.5.0) (2026-01-23)


### Features

* add AI actions for merge conflict resolution ([51d7e87](https://github.com/shkm/shellflow/commit/51d7e87ff6029338f0c6bbd764e9071c7bcd3f24))
* add minijinja templating for worktree directory configuration ([cf83d67](https://github.com/shkm/shellflow/commit/cf83d6793d2365ed4bb900f2c876c48c1e258b3a))
* add named task URLs and dynamic port support ([9727426](https://github.com/shkm/shellflow/commit/972742631701c17b9a1c72d408104f85cb4811cb))
* add rebase conflict resolution support ([9abbab5](https://github.com/shkm/shellflow/commit/9abbab5d550ce7bd7d95bd20c10e831187484007))
* add shell option when main task exits ([dbf7650](https://github.com/shkm/shellflow/commit/dbf765032899d10459ba8c41086f5c3234769653))
* add terminal zoom with configurable keyboard shortcuts ([7859c8d](https://github.com/shkm/shellflow/commit/7859c8dabdbd82c979e0bfbd59d3764001c545c0))
* add URL display and minijinja templating for tasks ([92ed5fc](https://github.com/shkm/shellflow/commit/92ed5fcaef296e00d7883fdbcb90d1a5ced74362))
* improve AI merge conflict resolution flow ([08ef8b8](https://github.com/shkm/shellflow/commit/08ef8b8b99bda43c5b33c6df327daa73a6323dd5))


### Bug Fixes

* button label and git directory resolution for worktrees ([4dc0709](https://github.com/shkm/shellflow/commit/4dc0709d7b4e758014343b39d38ae29a19813d15))
* correct path handling for rebase conflict resolution ([d7aae84](https://github.com/shkm/shellflow/commit/d7aae8437918de8f507425ab823ecc6e8b70f017))
* remove grab cursor on hover for draggable items ([8902aff](https://github.com/shkm/shellflow/commit/8902aff28ba08fcc7b39c1bdfbaf6e2165b27eb6))

## [0.4.0](https://github.com/shkm/shellflow/compare/v0.3.0...v0.4.0) (2026-01-22)


### Features

* add drag-and-drop reordering for tabs and sidebar items ([b355dd7](https://github.com/shkm/shellflow/commit/b355dd76fe451a6e3631828abc04dff6e9bf6d53))
* add worktree rename via double-click ([cb8d411](https://github.com/shkm/shellflow/commit/cb8d4117701e58a0c498bc95c87e0fdff5ec8243))
* display git commit hash in sidebar header ([2d98959](https://github.com/shkm/shellflow/commit/2d98959a8d92fcadc9e7e1deb3357be81e503183))
* improve progress indicators and add idle state ([815659f](https://github.com/shkm/shellflow/commit/815659f0fcc9a4d5afa31a0750a814bd7282171f))
* show progress checklist for multi-step operations ([9994675](https://github.com/shkm/shellflow/commit/9994675b701a9f22209535f79d807200b645f395))
* show running task status via green shortcut number color ([d77f69b](https://github.com/shkm/shellflow/commit/d77f69baf1c690b7d8e9918597c2b2dda5b93000))
* show task exit status in drawer tabs ([85040b5](https://github.com/shkm/shellflow/commit/85040b541715e65868f8347b314b3fb504371fae))


### Bug Fixes

* add background to sidebar status indicators to prevent text overlap ([44f1eec](https://github.com/shkm/shellflow/commit/44f1eec5c6410f3cc19dc89b80fc211ee8e8c1fa))
* enable allowProposedApi for ligatures addon in drawer terminals ([0417ffb](https://github.com/shkm/shellflow/commit/0417ffbe45bc9dc176e55d66a76bc53b1e873628))


### Performance Improvements

* optimize dev build profile for faster compilation ([740a19f](https://github.com/shkm/shellflow/commit/740a19fad6fbe7b44ac6a2a386396e19f745adfa))

## [0.3.0](https://github.com/shkm/shellflow/compare/v0.2.0...v0.3.0) (2026-01-22)


### Features

* add configurable worktree base branch ([2db2747](https://github.com/shkm/shellflow/commit/2db2747bc2e050f629602868cbec593cc021dce8))


### Bug Fixes

* remove default tasks from default config ([3b03462](https://github.com/shkm/shellflow/commit/3b03462a74fa018c899ea98834814197ab01dc30))
* run main command in project terminal, shell in drawers ([7308e4c](https://github.com/shkm/shellflow/commit/7308e4c3afb9548bd8cdb2a80972c69de064de0a))


### Miscellaneous Chores

* release 0.3.0 ([6fc98d2](https://github.com/shkm/shellflow/commit/6fc98d27486069b6f2e8a658f2295eda33b73690))

## [0.2.0](https://github.com/shkm/shellflow/compare/v0.1.0...v0.2.0) (2026-01-22)


### Features

* activate newly added projects immediately ([8a3c114](https://github.com/shkm/shellflow/commit/8a3c11482eae32a230c963d41b46a119edd4bfd1))
* add clickable links to all terminals ([a615878](https://github.com/shkm/shellflow/commit/a61587871881aef6cf4ecf85024058b571647025))
* add command palette task switcher ([e173a98](https://github.com/shkm/shellflow/commit/e173a988de9c0c6dbcd169007b449fa00572c4a2))
* add configurable tasks feature ([34b831a](https://github.com/shkm/shellflow/commit/34b831a27fbe23a334c453db897a7c724866334c))
* add drawer tab navigation and centralized modal tracking ([3bf2a17](https://github.com/shkm/shellflow/commit/3bf2a1712dea515cb8fbedf95ddf164455e94922))
* add font ligatures option ([6481743](https://github.com/shkm/shellflow/commit/6481743ef60c384937013b1800523d0052787339))
* add graceful shutdown with process cleanup ([0729601](https://github.com/shkm/shellflow/commit/072960187c8dc15edd2cf728b56f0f4c46e6fee3))
* add keyboard shortcut to expand drawer to full height ([80135d8](https://github.com/shkm/shellflow/commit/80135d8384a589eea3f0ac532338591bd1adeaf1))
* add keyboard shortcut to switch between current and previous view ([3c9d076](https://github.com/shkm/shellflow/commit/3c9d0766fe2d6cce6ed1b7513cbdd634478bc487))
* add keyboard shortcuts for run task, new workspace, and switch focus ([e4bac23](https://github.com/shkm/shellflow/commit/e4bac2399029c1bfe89173bb707f4e07bfa190df))
* add keyboard shortcuts to cycle through workspaces ([bd925b0](https://github.com/shkm/shellflow/commit/bd925b0ed2371ea4c89c319df22aa12b7a94bd97))
* add keyboard shortcuts to modal dialogs ([5275202](https://github.com/shkm/shellflow/commit/527520243d67b8cf175bffdc25b81026d5be33e9))
* add merge/rebase workflow for worktree branches ([10936c2](https://github.com/shkm/shellflow/commit/10936c217a9be263d24ff8ac6e6243ddde7c9add))
* add per-worktree right panel with toggle (Cmd+R) ([0d16e46](https://github.com/shkm/shellflow/commit/0d16e46b5670c146217ae3efb4ef9abb4209422c))
* add project-level terminal support ([9613e4b](https://github.com/shkm/shellflow/commit/9613e4be20dfc6c0a7d0ee20a9e98c3d4f8199b4))
* add running task indicator to sidebar with multi-task support ([0f610e3](https://github.com/shkm/shellflow/commit/0f610e36826f4cda00ced0d5e764444e12212631))
* add sidebar options menu with show active projects toggle ([c6e227d](https://github.com/shkm/shellflow/commit/c6e227dcb12cf41549027527b6c36bb94f2eea8e))
* add stash workflow for repos with uncommitted changes ([0da34d6](https://github.com/shkm/shellflow/commit/0da34d67a00888ec14433f61ca1e1c9a290bfa12))
* add stash workflow for repos with uncommitted changes ([b62fa8c](https://github.com/shkm/shellflow/commit/b62fa8c3c6ab0a7ace84b2c69f67f8d044e4e447))
* add terminal copy/paste with configurable shortcuts ([7eca3b7](https://github.com/shkm/shellflow/commit/7eca3b76034ca81129d1379f03bac8782273b0bd))
* add terminal notification support ([296dbf2](https://github.com/shkm/shellflow/commit/296dbf2ad4ad9f80b9b3c1c9458e8bc2b445f4da))
* add test infrastructure for frontend and Rust ([9803558](https://github.com/shkm/shellflow/commit/98035582ca34d96f1551fbe2a5e7b9d22ba96418))
* add thinking indicator for worktrees ([c11817b](https://github.com/shkm/shellflow/commit/c11817b9ba7e731ed6a55f7184b9df633f580455))
* add user-configurable keyboard mappings ([3935bbc](https://github.com/shkm/shellflow/commit/3935bbc6bd53ee940a1ec1c95d4b76d770b4f014))
* auto-focus terminal when toggling drawer ([5a72aae](https://github.com/shkm/shellflow/commit/5a72aae9550e343845a59c1a692fa06b058db223))
* auto-remove worktrees when folder is deleted externally ([39defbe](https://github.com/shkm/shellflow/commit/39defbefd175520041c1544fcc9d5595ffc34424))
* handle processes exiting gracefully ([4031a6f](https://github.com/shkm/shellflow/commit/4031a6f383956f0885e0df2c8a0eda864a9c1691))
* make worktree selection shortcuts configurable ([e432ad2](https://github.com/shkm/shellflow/commit/e432ad23fd14f0bcc8dec26fc5afa8cd5470a9a2))
* new icon, again, because I suck ([d84e0dc](https://github.com/shkm/shellflow/commit/d84e0dc1742ad92fd2089a5906f7a04fc129c9ee))
* persist focus state when switching workspaces ([679ed02](https://github.com/shkm/shellflow/commit/679ed0242206d6f41e7ea336df23742d088cceb3))
* show activity indicator during terminal output bursts ([d48e3c0](https://github.com/shkm/shellflow/commit/d48e3c0147f47eb60df41cf5b0ee49ba911caf9d))
* show git diff stats (+/-) in changed files panel ([cb079f4](https://github.com/shkm/shellflow/commit/cb079f480be8aacb5a08953271319566a1fccc8d))
* support project-specific config overrides ([127445e](https://github.com/shkm/shellflow/commit/127445ed9e9eb2e11f2da16707bbc8400dd73baf))
* support Shift+Enter for newline in terminal ([af1e380](https://github.com/shkm/shellflow/commit/af1e3802e3d3177bb22296f6c9d2b2518cdda230))


### Bug Fixes

* allow $schema property in config file ([d9c74e5](https://github.com/shkm/shellflow/commit/d9c74e5d5bbc58e1134e9407eba01522907e23be))
* allow tasks to run from projects without worktrees ([0cdd176](https://github.com/shkm/shellflow/commit/0cdd1764cbf5e65156f81fe37f19c6942163ff11))
* attach terminal onData handler immediately for query responses ([5af1d17](https://github.com/shkm/shellflow/commit/5af1d1754a66f88c63f1eb398e2c430b1c5312ed))
* check for existing branches before creating worktree ([1e5f4e7](https://github.com/shkm/shellflow/commit/1e5f4e71ea455fbadb7fe36aa1e59656fe8e1cbb))
* clarify nothing to merge when branch is up to date ([d6267d0](https://github.com/shkm/shellflow/commit/d6267d0c68fab0010761ffbb9423bf615b207922))
* close drawer and right panel when last worktree closes ([015b923](https://github.com/shkm/shellflow/commit/015b923927f7dd8f3f1530611106873d00578b6b))
* collapse drawer when closing last terminal tab ([92ea606](https://github.com/shkm/shellflow/commit/92ea6061cf6c9d3156bb6541b219cb77adc99106))
* correct neovim truecolor rendering in xterm.js ([2cc2ae7](https://github.com/shkm/shellflow/commit/2cc2ae7f8ee51ca63157ca012b1712e3ec8fcc55))
* correctly find task in array for handleToggleTask ([f6bfdc2](https://github.com/shkm/shellflow/commit/f6bfdc27a09bc8e3a71bee34577117d5ff2ec7df))
* focus drawer terminal when expanding via shortcut ([cc0d4bb](https://github.com/shkm/shellflow/commit/cc0d4bb93e6a4168463874326d09f0d666144e43))
* hide cleanup options when branch is up to date ([cb9d100](https://github.com/shkm/shellflow/commit/cb9d10004c8e9ef135f0473bfbfa2de4f2396efc))
* prevent drawer from opening on worktree start when no tabs exist ([2020906](https://github.com/shkm/shellflow/commit/2020906896c5cb32a7b4b7ed0e51ef90c1fd60d7))
* prevent orphaned PTYs from React StrictMode double-mount ([17e02f1](https://github.com/shkm/shellflow/commit/17e02f1eccaeab0b466606b3be76ff5fd4d4794a))
* remove keyboard hints from stash and confirm modal buttons ([9069201](https://github.com/shkm/shellflow/commit/906920122fa6b801eb775af72078b5f9ffe0cd51))
* run correct task when using cmd+enter in task switcher ([996023b](https://github.com/shkm/shellflow/commit/996023bef9d640538c3677df879159b7024698ad))
* run merge and cleanup operations in background thread ([c1e4cf1](https://github.com/shkm/shellflow/commit/c1e4cf19ae72c17ba1863006bbe0cee37160370e))
* simplify merge modal button labels and remove keyboard hints ([ca32376](https://github.com/shkm/shellflow/commit/ca323765d98e699857da56b71d23a896ef47e834))
* unify project and worktree views for shortcuts and indicators ([253af3f](https://github.com/shkm/shellflow/commit/253af3f24e087e68c46b9c2a65402a951465b4fb))
* use correct PTY type for drawer terminals in project view ([cd8f8ff](https://github.com/shkm/shellflow/commit/cd8f8ffecb9803ae74299dea2d61c2a1d68e94e1))
* use git CLI for stash operations with unique stash IDs ([ec11d1f](https://github.com/shkm/shellflow/commit/ec11d1fd98ea4189651dbbc0d16c808372c135a7))
* use LF for Shift+Enter newline insertion ([d575c08](https://github.com/shkm/shellflow/commit/d575c08e85570378149385d60129531e4c226ec0))
* use native clipboard API to bypass macOS paste protection ([73d00d8](https://github.com/shkm/shellflow/commit/73d00d8f285135ce67a4ea972eed2b6519d85756))
* use trailing-edge debounce in file watcher ([5a6b46c](https://github.com/shkm/shellflow/commit/5a6b46c00236e02a7c13a0289a0f3c0052ee339c))


### Performance Improvements

* make panel layout global and optimize terminal resize ([4117f0a](https://github.com/shkm/shellflow/commit/4117f0af4da9a33c18462e5edda06231cac2af6c))
* only resize active terminals on workspace switch ([aaa20b8](https://github.com/shkm/shellflow/commit/aaa20b89ab04fae185916004f41aeccac52d2d57))
* speed up terminal startup and fix DA1 query timeout ([ef047a7](https://github.com/shkm/shellflow/commit/ef047a7adae74d74994b668bbf583042531e179c))


### Miscellaneous Chores

* release 0.2.0 ([270a913](https://github.com/shkm/shellflow/commit/270a9135c230d70c3fa6ac9e5516ed7a4a511123))

## [Unreleased]

### Added
- Initial release with git worktree management
- Configurable main command (default: claude)
- Terminal panel with xterm.js
- File change tracking with git status
- Project and worktree sidebar
- Copy gitignored files to new worktrees
