// Raw-string imports for the Knowledge base markdown articles (webpack
// asset/source rule in next.config.js).
declare module "*.md" {
  const content: string;
  export default content;
}
