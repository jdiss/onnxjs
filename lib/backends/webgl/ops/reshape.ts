// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import {Attribute} from '../../../attribute';
import {Reshape} from '../../../ops/reshape';
import {Tensor} from '../../../tensor';
import {ShapeUtil} from '../../../util';
import {FunctionType, GlslPositionalFunction} from '../glsl-definitions';
import {ShapeUtilsGlslLib} from '../glsl-shape-utils-lib';
import {WebGLInferenceHandler} from '../inference-handler';
import {getPackedShape} from '../utils';

export class WebGLReshape extends Reshape {
  initialize(attributes: Attribute): void {
    this.outputShape = attributes.getInts('output_shape', []);
    this.dimsToKeep = attributes.getInts('dims_to_keep', []);
  }
  getOutputShape(inferenceHandler: WebGLInferenceHandler, inputShapes: number[][]): number[] {
    if (inputShapes.length >= 2) {
      return inputShapes[1];
    }
    if (this.outputShape.length > 0) {
      return this.outputShape;
    }
    if (this.dimsToKeep[0] === 0) {
      return inputShapes[0]
          .slice(0, this.dimsToKeep.length)
          .concat(inputShapes[0].slice(this.dimsToKeep[this.dimsToKeep.length - 1] + 1).reduce((a, b) => a * b));
    } else {
      return [inputShapes[0].slice(0, this.dimsToKeep[0]).reduce((a, b) => a * b)].concat(
          inputShapes[0].slice(this.dimsToKeep[0]));
    }
  }
  run(inferenceHandler: WebGLInferenceHandler, inputs: Tensor[]): Tensor[] {
    const inputShape = inputs[0].dims.slice();
    const inputShapes = [inputShape];
    if (inputs.length > 1) {
      inputShapes.push(ShapeUtil.calculateReshapedDims(inputShape, inputs[1].integerData));
    }
    const inputTD = inferenceHandler.getOrCreate(inputs[0]);
    const isInitializer = inferenceHandler.session.isInitializer(inputs[0]);
    const reshapedDims = this.getOutputShape(inferenceHandler, inputShapes);
    let packedShape = reshapedDims;
    if (inputTD.channels === 4) {
      packedShape = getPackedShape(reshapedDims);
    }
    const newTD = {
      channels: inputTD.channels,
      dataType: inputs[0].type,
      texture: inputTD.texture,
      height: inputTD.height,
      width: inputTD.width,
      shape: packedShape,
      strides: ShapeUtil.computeStrides(packedShape),
      unpackedShape: reshapedDims,
      arrayType: inputTD.arrayType
    };
    const newTensor = new Tensor(newTD.unpackedShape, newTD.dataType, (id: Tensor.Id) => {
      const values = inferenceHandler.textureHelper.readTexture(newTD, newTD.dataType, newTD.channels);
      return values;
    });
    if (isInitializer) {
      inferenceHandler.session.setTextureData(newTensor, newTD);
    } else {
      inferenceHandler.setTextureData(newTensor, newTD);
    }
    return [newTensor];
  }
  getPositionalFunction(inferenceHandler: WebGLInferenceHandler, inputShape: number[], name?: string):
      GlslPositionalFunction {
    const outputShape = this.getOutputShape(inferenceHandler, [inputShape]);
    if (!name) {
      name = 'reshape';
    }
    return {
      name,
      body: this.getReshapeFunctionBody(name, inputShape, outputShape),
      type: FunctionType.Positional,
      inputShape,
      outputShape
    };
  }
  protected getReshapeFunctionBody(name: string, inputShape: number[], outputShape: number[]): string {
    const inputStrides = ShapeUtil.computeStrides(inputShape);
    const outputStrides = ShapeUtil.computeStrides(outputShape);
    return `
      ${ShapeUtilsGlslLib.indexToOffsetSingle(`indicesToOffset_${name}`, outputShape.length, outputStrides)}
      ${ShapeUtilsGlslLib.offsetToIndicesSingle(`offsetToIndices_${name}`, inputShape.length, inputStrides)}
      void ${name}(out int a[${inputShape.length}], int src[${outputShape.length}]) {
        int offset = indicesToOffset_${name}(src);
        offsetToIndices_${name}(offset, a);
      }
    `;
  }
  protected outputShape: number[];
  protected dimsToKeep: number[];
}
