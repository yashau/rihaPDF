declare module "bidi-js" {
  type Paragraph = {
    start: number;
    end: number;
    level: number;
  };

  type EmbeddingLevels = {
    levels: Uint8Array;
    paragraphs: Paragraph[];
  };

  type Bidi = {
    getEmbeddingLevels(text: string, baseDirection?: "ltr" | "rtl"): EmbeddingLevels;
    getReorderSegments(
      text: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): Array<[number, number]>;
    getReorderedString(
      text: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): string;
    getReorderedIndices(
      text: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): number[];
    getMirroredCharactersMap(
      text: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): Map<number, string>;
  };

  export default function bidiFactory(): Bidi;
}
