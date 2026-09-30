/**
 * RichTextEditor — TipTap-based rich text editor for email composition.
 * Outputs clean HTML suitable for email sending.
 *
 * Toolbar: Bold, Italic, Underline, Headings, Lists, Link, Alignment, Clear
 */
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { useEffect, useImperativeHandle, forwardRef } from "react";
import {
  Bold, Italic, Underline as UnderlineIcon,
  List, ListOrdered, AlignLeft, AlignCenter, AlignRight,
  Link as LinkIcon, Minus, Heading2,
} from "lucide-react";

export interface RichTextEditorHandle {
  /** Insert text (e.g. a {{variable}}) at the current cursor position in the editor. */
  insertText: (text: string) => void;
  /** Insert an inline image (by hosted URL) at the cursor (#102). */
  insertImage: (src: string, alt?: string) => void;
}

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor({
  value, onChange, placeholder = "Write your message here…", minHeight = 200,
}, ref) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder }),
      Image.configure({ inline: false, HTMLAttributes: { style: "max-width:100%; height:auto;" } }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        style: `min-height:${minHeight}px; padding:12px; outline:none; font-family:Arial,sans-serif; font-size:14px; line-height:1.6;`,
      },
    },
  });

  // Expose insertText so parent components can inject variables at the cursor
  useImperativeHandle(ref, () => ({
    insertText: (text: string) => {
      if (editor) {
        editor.chain().focus().insertContent(text).run();
      }
    },
    insertImage: (src: string, alt?: string) => {
      if (editor) editor.chain().focus().setImage({ src, alt }).run();
    },
  }), [editor]);

  // Sync external value changes (e.g. loading a template)
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
    }
  }, [value]);

  if (!editor) return null;

  const btn = (active: boolean, onClick: () => void, title: string, icon: React.ReactNode) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        ...styles.toolBtn,
        background: active ? "#1a3a5c" : "transparent",
        color: active ? "#fff" : "#555",
      }}
    >
      {icon}
    </button>
  );

  function setLink() {
    const url = window.prompt("Enter URL:", editor!.getAttributes("link").href ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor!.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor!.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }

  return (
    <div style={styles.wrapper}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "Bold", <Bold size={14} />)}
        {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "Italic", <Italic size={14} />)}
        {btn(editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), "Underline", <UnderlineIcon size={14} />)}
        <div style={styles.sep} />
        {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "Heading", <Heading2 size={14} />)}
        <div style={styles.sep} />
        {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "Bullet list", <List size={14} />)}
        {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "Numbered list", <ListOrdered size={14} />)}
        <div style={styles.sep} />
        {btn(editor.isActive({ textAlign: "left" }), () => editor.chain().focus().setTextAlign("left").run(), "Align left", <AlignLeft size={14} />)}
        {btn(editor.isActive({ textAlign: "center" }), () => editor.chain().focus().setTextAlign("center").run(), "Align center", <AlignCenter size={14} />)}
        {btn(editor.isActive({ textAlign: "right" }), () => editor.chain().focus().setTextAlign("right").run(), "Align right", <AlignRight size={14} />)}
        <div style={styles.sep} />
        {btn(editor.isActive("link"), setLink, "Insert link", <LinkIcon size={14} />)}
        <div style={styles.sep} />
        <button
          type="button"
          title="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          style={styles.toolBtn}
        >
          <Minus size={14} />
        </button>
      </div>

      {/* Editor area */}
      <div style={styles.editorArea}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

export default RichTextEditor;

const styles: Record<string, React.CSSProperties> = {
  wrapper: { border: "1px solid #ccc", borderRadius: 7, overflow: "hidden", background: "#fff" },
  toolbar: { display: "flex", alignItems: "center", gap: 2, padding: "6px 8px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", flexWrap: "wrap" },
  toolBtn: { border: "none", cursor: "pointer", borderRadius: 4, padding: "5px 7px", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.1s" },
  sep: { width: 1, height: 18, background: "#e2e8f0", margin: "0 2px" },
  editorArea: { background: "#fff" },
};
