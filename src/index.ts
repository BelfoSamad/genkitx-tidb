import { embed, EmbedderArgument } from '@genkit-ai/ai/embedder';
import { CommonRetrieverOptionsSchema, Document, defineIndexer, defineRetriever, indexerRef, retrieverRef } from '@genkit-ai/ai/retriever';
import { genkitPlugin, PluginProvider } from '@genkit-ai/core';
import * as z from 'zod';
import { Md5 } from 'ts-md5';
import { DistanceMethod, TiDbClientParams as NativeTiDbClientParams } from './tidb/types';
import { add, getEmbeddingModel, initConnection, query } from './tidb/tidb_client';

//----------------------------------------- Types
/**
 * options for the TiDb Retriever and Indexer. The Retriever options are constructed of the CommonRetrieverOptions plus the include
 * attribute which states what to return: [documents, metadatas, embeddings, distances].
 * distance calculation method to use
 * Other options to be added later...
 */
const TiDbRetrieverOptionsSchema = CommonRetrieverOptionsSchema.extend({
    distanceMethod: z.nativeEnum(DistanceMethod).optional(),
    identifierId: z.string(),
});
export const TiDbIndexerOptionsSchema = z.object({
    identifierId: z.string(),
});

//----------------------------------------- Plugin
export function tidb<EmbedderCustomOptions extends z.ZodTypeAny>(
    params: {
        clientParams?: TiDbClientParams;
        tableName: string;
        embedder: EmbedderArgument<EmbedderCustomOptions>;
        embedderOptions?: z.infer<EmbedderCustomOptions>;
    }[]
): PluginProvider {
    const plugin = genkitPlugin(
        'tidb',
        async (
            params: {
                clientParams?: TiDbClientParams;
                tableName: string;
                embedder: EmbedderArgument<EmbedderCustomOptions>;
                embedderOptions?: z.infer<EmbedderCustomOptions>;
            }[]
        ) => ({
            retrievers: params.map((i) => tidbRetriever(i)),
            indexers: params.map((i) => tidbIndexer(i)),
        })
    );
    return plugin(params);
}

export default tidb;

//----------------------------------------- References
export const tidbRetrieverRef = (params: {
    tableName: string;
    displayName?: string;
}) => {
    return retrieverRef({
        name: `tidb/${params.tableName}`,
        info: { label: params.displayName ?? `TiDB - ${params.tableName}` },
        configSchema: TiDbRetrieverOptionsSchema.optional(),
    });
};

export const tidbIndexerRef = (params: {
    tableName: string;
    displayName?: string;
}) => {
    return indexerRef({
        name: `tidb/${params.tableName}`,
        info: { label: params.displayName ?? `TiDB - ${params.tableName}` },
        configSchema: TiDbIndexerOptionsSchema.optional(),
    });
};

//----------------------------------------- Retriever/Indexer
export function tidbRetriever<EmbedderCustomOptions extends z.ZodTypeAny>(
    params: {
        clientParams?: TiDbClientParams;
        tableName: string;
        embedder: EmbedderArgument<EmbedderCustomOptions>;
        embedderOptions?: z.infer<EmbedderCustomOptions>;
    }
) {
    const { embedder, tableName, embedderOptions } = params;
    return defineRetriever(
        {
            name: `tidb/${tableName}`,
            configSchema: TiDbRetrieverOptionsSchema.optional(),
        },
        async (content, options) => {
            const clientParams = await resolve(params.clientParams);
            
            // get client & model
            const sequelize = await initConnection(clientParams!!);
            const embeddingModel = getEmbeddingModel(sequelize, tableName);

            // get embedding
            const embedding = await embed({
                embedder,
                content,
                options: embedderOptions,
            });

            // query results
            const results = await query(
                embeddingModel,
                {
                    nResults: options?.k,
                    identifierId: options?.identifierId,
                    queryEmbeddings: embedding,
                    distanceMethod: options?.distanceMethod ?? DistanceMethod.Cosine,
                }
            )

            // return documents
            return {
                documents: results.documents.map((result) =>
                    Document.fromText(result!!).toJSON()
                ),
            };
        }
    )
}

export function tidbIndexer<EmbedderCustomOptions extends z.ZodTypeAny>(
    params: {
        clientParams?: TiDbClientParams;
        tableName: string;
        embedder: EmbedderArgument<EmbedderCustomOptions>;
        embedderOptions?: z.infer<EmbedderCustomOptions>;
    }
) {
    const { embedder, tableName, embedderOptions } = { ...params };
    console.log(params.tableName)
    return defineIndexer(
        {
            name: `tidb/${tableName}`,
            configSchema: TiDbIndexerOptionsSchema,
        },
        async (docs, options) => {
            const clientParams = await resolve(params.clientParams);

            // get client & model
            const sequelize = await initConnection(clientParams!!);
            const embeddingModel = getEmbeddingModel(sequelize, tableName);
            embeddingModel.sync();

            // embedd content
            const embeddings = await Promise.all(
                docs.map((doc) =>
                    embed({
                        embedder,
                        content: doc,
                        options: embedderOptions,
                    })
                )
            );

            // add ids and metadata to entries
            const entries = embeddings.map((value, i) => {
                const id = Md5.hashStr(JSON.stringify(docs[i]));
                return {
                    id,
                    value,
                    document: docs[i].text()
                };
            });

            // add data
            await add(
                embeddingModel,
                {
                    ids: entries.map((e) => e.id),
                    identifierId: options?.identifierId,
                    embeddings: entries.map((e) => e.value!!),
                    documents: entries.map((e) => e.document!!),
                }
            );
        }
    )
}

//----------------------------------------- Others
type TiDbClientParams =
    | NativeTiDbClientParams
    | (() => Promise<NativeTiDbClientParams>);

async function resolve(params?: TiDbClientParams): Promise<NativeTiDbClientParams | undefined> {
    if (!params) return undefined;
    if (typeof params === 'function') {
        return await params();
    }
    return params;
}