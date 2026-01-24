import { useState, useMemo, useCallback } from 'react';
import { Project } from '../../types';
import {
  ModalContainer,
  ModalSearchInput,
  ModalList,
  ModalListItem,
  ModalFooter,
  KeyHint,
  useModalNavigation,
} from '../Modal';

interface ProjectSwitcherProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
  onClose: () => void;
  onModalOpen?: () => void;
  onModalClose?: () => void;
}

export function ProjectSwitcher({
  projects,
  activeProjectId,
  onSelect,
  onClose,
  onModalOpen,
  onModalClose,
}: ProjectSwitcherProps) {
  const [query, setQuery] = useState('');

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  // Sort by lastAccessedAt (most recent first), then filter by query
  const sortedAndFilteredProjects = useMemo(() => {
    // Sort: active first, then by lastAccessedAt descending
    const sorted = [...projects].sort((a, b) => {
      const aTime = a.lastAccessedAt ? new Date(a.lastAccessedAt).getTime() : 0;
      const bTime = b.lastAccessedAt ? new Date(b.lastAccessedAt).getTime() : 0;
      return bTime - aTime;
    });

    if (!query.trim()) return sorted;

    const lowerQuery = query.toLowerCase();
    return sorted.filter(
      (project) =>
        project.name.toLowerCase().includes(lowerQuery) ||
        project.path.toLowerCase().includes(lowerQuery)
    );
  }, [projects, query]);

  // Handle project selection
  const handleSelect = useCallback(
    (index: number) => {
      const project = sortedAndFilteredProjects[index];
      if (project) {
        onSelect(project.id);
      }
    },
    [sortedAndFilteredProjects, onSelect]
  );

  const { highlightedIndex, setHighlightedIndex, handleKeyDown } = useModalNavigation({
    itemCount: sortedAndFilteredProjects.length,
    onSelect: handleSelect,
    onClose,
  });

  return (
    <ModalContainer onClose={onClose} onModalOpen={onModalOpen} onModalClose={onModalClose}>
      <ModalSearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search projects..."
        onKeyDown={handleKeyDown}
      />

      <ModalList isEmpty={sortedAndFilteredProjects.length === 0} emptyMessage="No projects found">
        {sortedAndFilteredProjects.map((project, index) => {
          const isHighlighted = index === highlightedIndex;
          const isSelected = project.id === activeProjectId;
          const isClosed = !project.isActive;

          return (
            <ModalListItem
              key={project.id}
              isHighlighted={isHighlighted}
              onClick={() => handleSelect(index)}
              onMouseEnter={() => setHighlightedIndex(index)}
              rightContent={
                isClosed && <span className="text-xs text-zinc-500">Closed</span>
              }
            >
              <div
                className={`text-sm truncate ${
                  isSelected ? 'text-blue-400' : isClosed ? 'text-zinc-500' : 'text-zinc-100'
                }`}
              >
                {project.name}
              </div>
              <div className="text-xs text-zinc-500 truncate">{project.path}</div>
            </ModalListItem>
          );
        })}
      </ModalList>

      <ModalFooter>
        <div>
          <KeyHint keys={[isMac ? '⌘' : 'Ctrl', 'J/K']} label="navigate" />
        </div>
        <div>
          <KeyHint keys={['Enter']} label="open" />
        </div>
      </ModalFooter>
    </ModalContainer>
  );
}
