export enum DistanceMethod {
    L2 = "VEC_L2_DISTANCE",
    Cosine = "VEC_COSINE_DISTANCE",
    NegativeInnerProduct = "VEC_NEGATIVE_INNER_PRODUCT",
    L1 = "VEC_L1_DISTANCE",
}

export type TiDbClientParams = {
    host?: string;
    user?: string;
    password?: string;
    database?: string;
    port?: number;
};

export type QueryParams = {
    queryEmbeddings: number[];
    identifierId?: string,
    nResults?: number;
    distanceMethod?: DistanceMethod;
};

export type QueryResponse = {
    ids: string[];
    embeddings: (number[])[] | null;
    documents: (string | null)[];
};

export type InsertParams = {
    identifierId?: string,
    ids: string[],
    embeddings: (number[])[],
    documents: string[]
}