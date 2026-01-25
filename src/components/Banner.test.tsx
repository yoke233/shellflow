import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Banner } from './Banner';

describe('Banner', () => {
  it('renders children content', () => {
    render(<Banner variant="info">Test message</Banner>);
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('applies error variant styles', () => {
    render(<Banner variant="error">Error message</Banner>);
    const banner = screen.getByText('Error message').closest('div[class*="bg-red"]');
    expect(banner).toBeInTheDocument();
  });
});
