import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/utils';

interface MarkdownMessageProps {
  content: string;
  className?: string;
}

/** Renders assistant markdown with styled prose, code blocks, and GFM tables. */
export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, className }) => {
  return (
    <div className={cn('markdown-body', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
        // Code blocks & inline code
        code({ node, className: codeClass, children, ...props }) {
          const isInline = !codeClass;
          if (isInline) {
            return (
              <code className="bg-secondary/80 text-[12.5px] px-1.5 py-0.5 rounded-[4px] font-mono" {...props}>
                {children}
              </code>
            );
          }
          const lang = codeClass?.replace('language-', '') || '';
          return (
            <div className="relative group my-3">
              {lang && (
                <span className="absolute top-0 right-0 px-2 py-0.5 text-[10px] text-muted-foreground/60 font-mono select-none">
                  {lang}
                </span>
              )}
              <pre className="bg-[hsl(220,10%,96%)] border rounded-lg p-3.5 overflow-x-auto">
                <code className={cn('text-[12.5px] leading-relaxed font-mono', codeClass)} {...props}>
                  {children}
                </code>
              </pre>
            </div>
          );
        },

        // Headings
        h1: ({ children }) => <h1 className="text-lg font-semibold mt-4 mb-2 text-foreground">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-semibold mt-3.5 mb-1.5 text-foreground">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1 text-foreground">{children}</h3>,

        // Paragraphs
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,

        // Lists
        ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,

        // Links
        a: ({ href, children }) => (
          <a href={href} className="text-primary underline underline-offset-2 hover:opacity-80" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),

        // Blockquote
        blockquote: ({ children }) => (
          <blockquote className="border-l-[3px] border-primary/30 pl-3 my-2 text-muted-foreground italic">
            {children}
          </blockquote>
        ),

        // Table (GFM)
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full text-[12.5px] border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="border-b">{children}</thead>,
        th: ({ children }) => <th className="text-left px-2 py-1 font-semibold text-muted-foreground">{children}</th>,
        td: ({ children }) => <td className="px-2 py-1 border-t border-border/50">{children}</td>,

        // Horizontal rule
        hr: () => <hr className="my-3 border-border" />,

        // Strong / em
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  );
};
