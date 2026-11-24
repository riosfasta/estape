import fs from 'node:fs';
import path from 'node:path';

export interface Post {
  id: string;
  slug: string;
  title: string;
  category: string;
  categories?: string[];
  categorySlugs?: string[];
  date: string; // ISO date YYYY-MM-DD for sorting
  formattedDate: string;
  image: string;
  excerpt: string;
  readTime: string;
  author: {
    name: string;
    role: string;
    avatar: string;
  };
  content: string; // Full HTML / formatted content
  css?: string;
  projectData?: any;
  updatedAt?: string;
  keywords?: string;
  tags?: string[] | string;
  schema?: string;
  showRelated?: boolean;
  relatedTagline?: string;
  relatedTitle?: string;
  relatedCategory?: string;
  relatedOrderBy?: string;
  relatedLimit?: number;
  relatedHtml?: string;
  layoutMode?: 'standard' | 'blank';
  layoutId?: string;
}

export const defaultPosts: Post[] = [
  {
    id: '1',
    slug: 'branding-identity-modern-age',
    title: 'Branding: Membangun Identitas Visual yang Abadi di Era Digital',
    category: 'Branding',
    date: '2026-10-24',
    formattedDate: '24 Oktober 2026',
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80',
    excerpt: 'Bagaimana pendekatan desain identitas visual yang tepat dapat mengangkat kredibilitas bisnis Anda dan menarik audiens yang setia.',
    readTime: '5 min read',
    author: {
      name: 'Sarah Jenkins',
      role: 'Head of Brand Strategy',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&h=240&q=80',
    },
    content: `
      <p class="lead">
        Di pasar yang begitu kompetitif hari ini, merek bukan lagi sekadar logo atau kombinasi palet warna. Merek adalah persepsi, emosi, dan janji yang dirasakan pelanggan setiap kali berinteraksi dengan produk Anda.
      </p>

      <h2>1. Mengapa Identitas Visual Sangat Penting?</h2>
      <p>
        Banyak bisnis pemula terjebak dalam perang harga karena mereka gagal mengkomunikasikan nilai pembeda (value proposition). Ketika identitas visual Anda dikonsep dengan matang, konsumen dapat dengan cepat mengenali karakter, profesionalitas, dan kualitas yang ditawarkan.
      </p>
      
      <blockquote>
        "Desain bukan hanya tentang bagaimana sesuatu terlihat dan terasa. Desain adalah tentang bagaimana sesuatu itu bekerja dan beresonansi di hati audiens."
      </blockquote>

      <h2>2. Konsistensi Lintas Titik Kontak (Touchpoints)</h2>
      <p>
        Mulai dari kemasan fisik, kartu nama, situs web, hingga konten media sosial, setiap elemen visual harus berbicara dalam bahasa yang sama. Tanpa konsistensi, audiens akan merasa bingung dan ragu terhadap integritas merek Anda.
      </p>

      <h2>3. Tips Memulai Re-branding</h2>
      <ul>
        <li><strong>Kenali audiens inti:</strong> Cari tahu apa aspirasi dan kendala terbesar yang mereka hadapi.</li>
        <li><strong>Fokus pada kesederhanaan:</strong> Desain yang sederhana jauh lebih mudah diingat dan diterapkan di berbagai media.</li>
        <li><strong>Dokumentasikan Brand Guidelines:</strong> Buat pedoman penggunaan warna, tipografi, dan gaya fotografi agar tim Anda selalu sejalan.</li>
      </ul>

      <p>
        Melalui proses penentuan strategi yang matang, tim Better Corp siap mendampingi perjalanan brand Anda dari tahap konseptual hingga peluncuran menyeluruh ke pasar global.
      </p>
    `,
  },
  {
    id: '2',
    slug: 'online-marketing-strategies-growth',
    title: 'Online Marketing: Strategi Pertumbuhan Terukur untuk Bisnis Modern',
    category: 'Online Marketing',
    date: '2026-10-18',
    formattedDate: '18 Oktober 2026',
    image: 'https://images.unsplash.com/photo-1432888498266-38ffec3eaf0a?auto=format&fit=crop&w=1200&q=80',
    excerpt: 'Eksplorasi taktik pemasaran digital terbaru yang menggabungkan SEO, automasi konten, dan analitik berbasis data.',
    readTime: '4 min read',
    author: {
      name: 'Michael Chen',
      role: 'Growth Marketing Lead',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=240&h=240&q=80',
    },
    content: `
      <p class="lead">
        Era pemasaran tebak-tebakan sudah berakhir. Hari ini, setiap rupiah anggaran pemasaran yang Anda keluarkan harus dapat diukur hasilnya secara transparan menggunakan analitik modern.
      </p>

      <h2>1. Mengintegrasikan SEO Organik dan Iklan Berbayar</h2>
      <p>
        Mendapatkan traffic jangka panjang membutuhkan fondasi SEO yang kokoh, sementara kampanye berbayar (PPC) memberikan lonjakan cepat untuk validasi produk dan pengujian pesan pemasaran.
      </p>

      <h2>2. Personalisasi dan Automasi Pesan</h2>
      <p>
        Audiens hari ini mengharapkan komunikasi yang relevan secara personal. Automasi email dan alur kerja customer journey memastikan calon pembeli mendapatkan edukasi yang mereka butuhkan pada saat yang paling tepat.
      </p>

      <blockquote>
        "Pertumbuhan bisnis yang berkelanjutan tercipta ketika akuisisi pelanggan bertemu dengan pengalaman retensi yang memuaskan."
      </blockquote>

      <h2>3. Mengukur Metrik yang Sebenarnya Penting</h2>
      <p>
        Hindari terbuai oleh vanity metrics seperti sekadar jumlah 'likes' atau impresi. Fokuskan perhatian Anda pada CAC (Customer Acquisition Cost), LTV (Lifetime Value), dan tingkat konversi halaman penjualan Anda.
      </p>
    `,
  },
  {
    id: '3',
    slug: 'graphic-design-principles-conversion',
    title: 'Graphic Design: Prinsip Tata Letak & Hierarki Visual yang Mengonversi',
    category: 'Graphic Design',
    date: '2026-10-12',
    formattedDate: '12 Oktober 2026',
    image: 'https://images.unsplash.com/photo-1542744094-3a31f272c490?auto=format&fit=crop&w=1200&q=80',
    excerpt: 'Pelajari bagaimana pengaturan whitespace, kontras, dan tipografi dapat mengarahkan mata pengunjung langsung ke tombol aksi utama.',
    readTime: '6 min read',
    author: {
      name: 'Emily Blunt',
      role: 'Senior UI/Visual Designer',
      avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=240&h=240&q=80',
    },
    content: `
      <p class="lead">
        Banyak situs web terlihat ramai namun gagal menghasilkan penjualan. Kunci utama keberhasilan sebuah tampilan bukan terletak pada seberapa banyak ornamen grafis, melainkan seberapa jelas hierarki informasinya.
      </p>

      <h2>1. Kekuatan Ruang Negatif (Whitespace)</h2>
      <p>
        Ruang kosong bukan ruang terbuang; ruang kosong adalah jeda yang memberikan nafas bagi mata pembaca untuk mencerna informasi kunci tanpa merasa terbebani.
      </p>

      <h2>2. Kontras Menentukan Arah Perhatian</h2>
      <p>
        Elemen dengan kontras tertinggi secara alami akan menjadi titik fokus pertama. Pastikan elemen tersebut adalah proposisi nilai utama dan tombol Call to Action (CTA) Anda.
      </p>

      <blockquote>
        "Kesempurnaan bukan dicapai ketika tidak ada lagi yang bisa ditambahkan, tetapi ketika tidak ada lagi yang bisa dihilangkan."
      </blockquote>

      <h2>3. Skala Tipografi Modular</h2>
      <p>
        Gunakan rasio perbandingan tipografi yang terstruktur (seperti Major Third atau Golden Ratio) agar judul, sub-judul, dan teks isi memiliki irama ritmis yang menyenangkan saat dibaca.
      </p>
    `,
  },
];

const POSTS_FILE = path.join(process.cwd(), 'src', 'data', 'posts.json');

export function getPosts(): Post[] {
  try {
    if (fs.existsSync(POSTS_FILE)) {
      const data = fs.readFileSync(POSTS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return defaultPosts;
}

export function getPostBySlug(slug: string): Post | undefined {
  const all = getPosts();
  return all.find((p) => p.slug === slug || p.id === slug);
}

export function writePostsSync(postsList: Post[]): void {
  fs.writeFileSync(POSTS_FILE, JSON.stringify(postsList, null, 2), 'utf-8');
}

// Backward-compatible static export for imports like `import { posts } from ...`
export const posts: Post[] = getPosts();
