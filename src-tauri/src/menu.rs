use parking_lot::RwLock;
use std::collections::HashMap;
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager};

use crate::config::MappingsConfig;

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
pub fn setup_menu(app: &tauri::App, mappings: &MappingsConfig) -> Result<(), Box<dyn std::error::Error>> {
    let mut dynamic_items = DynamicMenuItems::new();

    // === App Menu (Shellflow) ===
    let about_item = PredefinedMenuItem::about(app, Some("About Shellflow"), None)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit Shellflow")
        .accelerator(mappings.quit.to_accelerator())
        .build(app)?;

    let app_submenu = SubmenuBuilder::new(app, "Shellflow")
        .item(&about_item)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide Shellflow"))?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&quit_item)
        .build()?;

    // === File Menu ===
    let add_project = MenuItemBuilder::with_id("add_project", "Add Project…")
        .accelerator(mappings.add_project.to_accelerator())
        .build(app)?;
    // add_project is always enabled, no need to track it

    let switch_project = MenuItemBuilder::with_id("switch_project", "Switch Project…")
        .accelerator(mappings.project_switcher.to_accelerator())
        .build(app)?;
    // switch_project is always enabled, no need to track it

    let new_worktree = MenuItemBuilder::with_id("new_worktree", "New Worktree")
        .accelerator(mappings.new_workspace.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("new_worktree", new_worktree.clone());

    let new_scratch_terminal =
        MenuItemBuilder::with_id("new_scratch_terminal", "New Scratch Terminal")
            .accelerator(mappings.new_scratch_terminal.to_accelerator())
            .enabled(false)
            .build(app)?;
    dynamic_items.insert("new_scratch_terminal", new_scratch_terminal.clone());

    let new_tab = MenuItemBuilder::with_id("new_tab", "New Tab")
        .accelerator(mappings.new_tab.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("new_tab", new_tab.clone());

    let close_tab = MenuItemBuilder::with_id("close_tab", "Close")
        .accelerator(mappings.close_tab.to_accelerator())
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

    let close_project = MenuItemBuilder::with_id("close_project", "Close Project…")
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("close_project", close_project.clone());

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&add_project)
        .item(&switch_project)
        .separator()
        .item(&new_worktree)
        .item(&new_scratch_terminal)
        .item(&new_tab)
        .separator()
        .item(&close_tab)
        .separator()
        .item(&open_in_finder)
        .item(&open_in_terminal)
        .item(&open_in_editor)
        .separator()
        .item(&close_project)
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
        .accelerator(mappings.toggle_drawer.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("toggle_drawer", toggle_drawer.clone());

    let toggle_right_panel =
        MenuItemBuilder::with_id("toggle_right_panel", "Toggle Changed Files")
            .accelerator(mappings.toggle_right_panel.to_accelerator())
            .enabled(false)
            .build(app)?;
    dynamic_items.insert("toggle_right_panel", toggle_right_panel.clone());

    let expand_drawer = MenuItemBuilder::with_id("expand_drawer", "Expand Drawer")
        .accelerator(mappings.expand_drawer.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("expand_drawer", expand_drawer.clone());

    let command_palette = MenuItemBuilder::with_id("command_palette", "Command Palette…")
        .accelerator(mappings.command_palette.to_accelerator())
        .build(app)?;
    // command_palette is always enabled, no need to track it

    let zoom_in = MenuItemBuilder::with_id("zoom_in", "Zoom In")
        .accelerator(mappings.zoom_in.to_accelerator())
        .build(app)?;
    let zoom_out = MenuItemBuilder::with_id("zoom_out", "Zoom Out")
        .accelerator(mappings.zoom_out.to_accelerator())
        .build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("zoom_reset", "Reset Zoom")
        .accelerator(mappings.zoom_reset.to_accelerator())
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
        .accelerator(mappings.worktree_prev.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree_prev", prev_worktree.clone());

    let next_worktree = MenuItemBuilder::with_id("worktree_next", "Next Worktree")
        .accelerator(mappings.worktree_next.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree_next", next_worktree.clone());

    let previous_view = MenuItemBuilder::with_id("previous_view", "Previous View")
        .accelerator(mappings.previous_view.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("previous_view", previous_view.clone());

    let switch_focus = MenuItemBuilder::with_id("switch_focus", "Switch Focus")
        .accelerator(mappings.switch_focus.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("switch_focus", switch_focus.clone());

    // Session 1-9 (sidebar navigation)
    let entity1 = MenuItemBuilder::with_id("worktree1", "Session 1")
        .accelerator(mappings.session1.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree1", entity1.clone());

    let entity2 = MenuItemBuilder::with_id("worktree2", "Session 2")
        .accelerator(mappings.session2.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree2", entity2.clone());

    let entity3 = MenuItemBuilder::with_id("worktree3", "Session 3")
        .accelerator(mappings.session3.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree3", entity3.clone());

    let entity4 = MenuItemBuilder::with_id("worktree4", "Session 4")
        .accelerator(mappings.session4.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree4", entity4.clone());

    let entity5 = MenuItemBuilder::with_id("worktree5", "Session 5")
        .accelerator(mappings.session5.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree5", entity5.clone());

    let entity6 = MenuItemBuilder::with_id("worktree6", "Session 6")
        .accelerator(mappings.session6.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree6", entity6.clone());

    let entity7 = MenuItemBuilder::with_id("worktree7", "Session 7")
        .accelerator(mappings.session7.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree7", entity7.clone());

    let entity8 = MenuItemBuilder::with_id("worktree8", "Session 8")
        .accelerator(mappings.session8.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree8", entity8.clone());

    let entity9 = MenuItemBuilder::with_id("worktree9", "Session 9")
        .accelerator(mappings.session9.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("worktree9", entity9.clone());

    let rename_branch = MenuItemBuilder::with_id("rename_branch", "Rename Branch…")
        .accelerator(mappings.rename_branch.to_accelerator())
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

    let worktree_submenu = SubmenuBuilder::new(app, "Navigate")
        .item(&prev_worktree)
        .item(&next_worktree)
        .separator()
        .item(&previous_view)
        .item(&switch_focus)
        .separator()
        .item(&entity1)
        .item(&entity2)
        .item(&entity3)
        .item(&entity4)
        .item(&entity5)
        .item(&entity6)
        .item(&entity7)
        .item(&entity8)
        .item(&entity9)
        .separator()
        .item(&rename_branch)
        .item(&merge_worktree)
        .item(&delete_worktree)
        .build()?;

    // === Tasks Menu ===
    let run_task = MenuItemBuilder::with_id("run_task", "Run Task")
        .accelerator(mappings.run_task.to_accelerator())
        .enabled(false)
        .build(app)?;
    dynamic_items.insert("run_task", run_task.clone());

    let task_switcher = MenuItemBuilder::with_id("task_switcher", "Task Switcher")
        .accelerator(mappings.task_switcher.to_accelerator())
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
    let help_docs = MenuItemBuilder::with_id("help_docs", "Shellflow Help")
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
