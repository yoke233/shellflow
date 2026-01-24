use parking_lot::RwLock;
use std::collections::HashMap;
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager};

/// Holds references to menu items that can be dynamically enabled/disabled.
pub struct DynamicMenuItems {
    items: HashMap<String, MenuItem<tauri::Wry>>,
}

impl DynamicMenuItems {
    pub fn new() -> Self {
        Self {
            items: HashMap::new(),
        }
    }

    pub fn insert(&mut self, id: &str, item: MenuItem<tauri::Wry>) {
        self.items.insert(id.to_string(), item);
    }

    /// Update menu item enabled states based on the provided availability map
    pub fn update_availability(&self, availability: &HashMap<String, bool>) {
        for (id, enabled) in availability {
            if let Some(item) = self.items.get(id) {
                let _ = item.set_enabled(*enabled);
            }
        }
    }
}

/// Global storage for dynamic menu items
pub static MENU_ITEMS: RwLock<Option<DynamicMenuItems>> = RwLock::new(None);

/// Initialize and build the application menu
pub fn setup_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let mut dynamic_items = DynamicMenuItems::new();

    // === App Menu (One Man Band) ===
    let about_item = PredefinedMenuItem::about(app, Some("About One Man Band"), None)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit One Man Band")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let app_submenu = SubmenuBuilder::new(app, "One Man Band")
        .item(&about_item)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide One Man Band"))?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&quit_item)
        .build()?;

    // === File Menu ===
    let add_project = MenuItemBuilder::with_id("add_project", "Add Project…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    // add_project is always enabled, no need to track it

    let new_worktree = MenuItemBuilder::with_id("new_worktree", "New Worktree")
        .accelerator("CmdOrCtrl+N")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("new_worktree", new_worktree.clone());

    let close_tab = MenuItemBuilder::with_id("close_tab", "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("close_tab", close_tab.clone());

    let open_in_finder = MenuItemBuilder::with_id("open_in_finder", "Open in Finder")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("open_in_finder", open_in_finder.clone());

    let open_in_terminal = MenuItemBuilder::with_id("open_in_terminal", "Open in Terminal")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("open_in_terminal", open_in_terminal.clone());

    let open_in_editor = MenuItemBuilder::with_id("open_in_editor", "Open in Editor")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("open_in_editor", open_in_editor.clone());

    let set_inactive = MenuItemBuilder::with_id("set_inactive", "Set Inactive")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("set_inactive", set_inactive.clone());

    let remove_project = MenuItemBuilder::with_id("remove_project", "Remove Project…")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("remove_project", remove_project.clone());

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&add_project)
        .item(&new_worktree)
        .separator()
        .item(&close_tab)
        .separator()
        .item(&open_in_finder)
        .item(&open_in_terminal)
        .item(&open_in_editor)
        .item(&set_inactive)
        .separator()
        .item(&remove_project)
        .build()?;

    // === Edit Menu ===
    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    // === View Menu ===
    let toggle_drawer = MenuItemBuilder::with_id("toggle_drawer", "Toggle Drawer")
        .accelerator("Ctrl+`")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("toggle_drawer", toggle_drawer.clone());

    let toggle_right_panel =
        MenuItemBuilder::with_id("toggle_right_panel", "Toggle Changed Files")
            .accelerator("CmdOrCtrl+B")
            .enabled(false)
            .build(app)?;
    dynamic_items.insert("toggle_right_panel", toggle_right_panel.clone());

    let expand_drawer = MenuItemBuilder::with_id("expand_drawer", "Expand Drawer")
        .accelerator("Shift+Escape")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("expand_drawer", expand_drawer.clone());

    let command_palette = MenuItemBuilder::with_id("command_palette", "Command Palette…")
        .accelerator("CmdOrCtrl+Shift+P")
        .build(app)?;
    // command_palette is always enabled, no need to track it

    let zoom_in = MenuItemBuilder::with_id("zoom_in", "Zoom In")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let zoom_out = MenuItemBuilder::with_id("zoom_out", "Zoom Out")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("zoom_reset", "Reset Zoom")
        .accelerator("CmdOrCtrl+Shift+0")
        .build(app)?;

    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(&command_palette)
        .separator()
        .item(&toggle_drawer)
        .item(&toggle_right_panel)
        .item(&expand_drawer)
        .separator()
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .build()?;

    // === Worktree Menu ===
    let prev_worktree = MenuItemBuilder::with_id("worktree_prev", "Previous Worktree")
        .accelerator("CmdOrCtrl+K")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree_prev", prev_worktree.clone());

    let next_worktree = MenuItemBuilder::with_id("worktree_next", "Next Worktree")
        .accelerator("CmdOrCtrl+J")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree_next", next_worktree.clone());

    let previous_view = MenuItemBuilder::with_id("previous_view", "Previous View")
        .accelerator("CmdOrCtrl+'")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("previous_view", previous_view.clone());

    let switch_focus = MenuItemBuilder::with_id("switch_focus", "Switch Focus")
        .accelerator("Ctrl+\\")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("switch_focus", switch_focus.clone());

    // Worktree 1-9
    let worktree1 = MenuItemBuilder::with_id("worktree1", "Worktree 1")
        .accelerator("CmdOrCtrl+1")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree1", worktree1.clone());

    let worktree2 = MenuItemBuilder::with_id("worktree2", "Worktree 2")
        .accelerator("CmdOrCtrl+2")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree2", worktree2.clone());

    let worktree3 = MenuItemBuilder::with_id("worktree3", "Worktree 3")
        .accelerator("CmdOrCtrl+3")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree3", worktree3.clone());

    let worktree4 = MenuItemBuilder::with_id("worktree4", "Worktree 4")
        .accelerator("CmdOrCtrl+4")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree4", worktree4.clone());

    let worktree5 = MenuItemBuilder::with_id("worktree5", "Worktree 5")
        .accelerator("CmdOrCtrl+5")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree5", worktree5.clone());

    let worktree6 = MenuItemBuilder::with_id("worktree6", "Worktree 6")
        .accelerator("CmdOrCtrl+6")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree6", worktree6.clone());

    let worktree7 = MenuItemBuilder::with_id("worktree7", "Worktree 7")
        .accelerator("CmdOrCtrl+7")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree7", worktree7.clone());

    let worktree8 = MenuItemBuilder::with_id("worktree8", "Worktree 8")
        .accelerator("CmdOrCtrl+8")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree8", worktree8.clone());

    let worktree9 = MenuItemBuilder::with_id("worktree9", "Worktree 9")
        .accelerator("CmdOrCtrl+9")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree9", worktree9.clone());

    let rename_branch = MenuItemBuilder::with_id("rename_branch", "Rename Branch…")
        .accelerator("F2")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("rename_branch", rename_branch.clone());

    let merge_worktree = MenuItemBuilder::with_id("merge_worktree", "Merge Worktree…")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("merge_worktree", merge_worktree.clone());

    let delete_worktree = MenuItemBuilder::with_id("delete_worktree", "Delete Worktree…")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("delete_worktree", delete_worktree.clone());

    let worktree_submenu = SubmenuBuilder::new(app, "Worktree")
        .item(&prev_worktree)
        .item(&next_worktree)
        .separator()
        .item(&previous_view)
        .item(&switch_focus)
        .separator()
        .item(&worktree1)
        .item(&worktree2)
        .item(&worktree3)
        .item(&worktree4)
        .item(&worktree5)
        .item(&worktree6)
        .item(&worktree7)
        .item(&worktree8)
        .item(&worktree9)
        .separator()
        .item(&rename_branch)
        .item(&merge_worktree)
        .item(&delete_worktree)
        .build()?;

    // === Tasks Menu ===
    let run_task = MenuItemBuilder::with_id("run_task", "Run Task")
        .accelerator("CmdOrCtrl+R")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("run_task", run_task.clone());

    let task_switcher = MenuItemBuilder::with_id("task_switcher", "Task Switcher")
        .accelerator("CmdOrCtrl+;")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("task_switcher", task_switcher.clone());

    let tasks_submenu = SubmenuBuilder::new(app, "Tasks")
        .item(&run_task)
        .item(&task_switcher)
        .build()?;

    // === Window Menu ===
    let window_submenu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    // === Help Menu ===
    // On macOS, naming this "Help" automatically adds the search field
    let help_docs = MenuItemBuilder::with_id("help_docs", "One Man Band Help")
        .build(app)?;
    let help_report_issue = MenuItemBuilder::with_id("help_report_issue", "Report Issue…")
        .build(app)?;
    let help_release_notes = MenuItemBuilder::with_id("help_release_notes", "Release Notes")
        .build(app)?;

    let help_submenu = SubmenuBuilder::new(app, "Help")
        .item(&help_docs)
        .separator()
        .item(&help_report_issue)
        .item(&help_release_notes)
        .build()?;

    // Build the complete menu
    let menu = MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&worktree_submenu)
        .item(&tasks_submenu)
        .item(&window_submenu)
        .item(&help_submenu)
        .build()?;

    app.set_menu(menu)?;

    // Store dynamic items for later updates
    *MENU_ITEMS.write() = Some(dynamic_items);

    // Set up menu event handler
    app.on_menu_event(move |app_handle, event| {
        let menu_id = event.id().as_ref();
        if let Some(window) = app_handle.get_webview_window("main") {
            match menu_id {
                "quit" => {
                    // Trigger graceful shutdown via window close
                    let _ = window.emit("close-requested", ());
                }
                // Emit menu action events to the frontend
                id => {
                    let _ = window.emit("menu-action", id);
                }
            }
        }
    });

    Ok(())
}

/// Update menu item enabled states based on action availability from frontend
pub fn update_action_availability(availability: HashMap<String, bool>) {
    if let Some(ref items) = *MENU_ITEMS.read() {
        items.update_availability(&availability);
    }
}
